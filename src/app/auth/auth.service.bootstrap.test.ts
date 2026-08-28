import '@angular/compiler';
import { Injector } from '@angular/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AccessTokenResponse, Client, UserProfileResponse } from '../api/generated/gones-api';
import { AuthSessionCoordinationService } from './auth-session-coordination.service';
import { AuthService } from './auth.service';
import { installFakeWebLocks, removeWebLocks, SharedFakeWebLocks } from './fake-web-locks';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const profile = { id: 'u1', email: 'u@example.test', emailVerified: true, globalRole: 'User', username: 'user', firstName: 'U', lastName: 'Ser', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false, isPreferredLanguagePublic: false } as unknown as UserProfileResponse;
const otherProfile = { ...profile, id: 'u2', email: 'u2@example.test', username: 'user-b' } as UserProfileResponse;
const token = { accessToken: 'memory-token', tokenType: 'Bearer', expiresAt: {} } as AccessTokenResponse;

/** The API mints a JWT carrying the account id in `sub`, which is what records who owns a generation. */
function accountToken(profileId: string): AccessTokenResponse {
  const claims = btoa(JSON.stringify({ sub: profileId })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { ...token, accessToken: `header.${claims}.signature` };
}

function setup(refresh: () => Observable<AccessTokenResponse>) {
  const client = {
    refresh: vi.fn(refresh),
    meGET: vi.fn(() => of(profile)),
    login: vi.fn(() => of(token)),
    logout: vi.fn(() => of(undefined)),
    logoutAll: vi.fn(() => of(undefined))
  };
  const catalogSync = { adopt: vi.fn(async () => undefined) };
  const injector = Injector.create({ providers: [AuthService, AuthSessionCoordinationService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }, { provide: SessionCatalogSyncService, useValue: catalogSync }] });
  return { service: injector.get(AuthService), store: injector.get(ApiAccessTokenStore), sessionScope: injector.get(SessionScopeService), coordination: injector.get(AuthSessionCoordinationService), client, catalogSync };
}

describe('AuthService.bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeWebLocks();
  });

  it('restores the session from the refresh cookie before the first route renders', async () => {
    const { service, store, client } = setup(() => of(token));

    await service.bootstrap();

    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(service.profile()).not.toBeNull();
    expect(service.profile()?.username).toBe('user');
    expect(store.token).toBe('memory-token');
    expect(service.bootstrapped()).toBe(true);
    expect(service.bootstrapFailed()).toBe(false);
  });

  it('records the failure and still finishes bootstrapping when there is no usable cookie', async () => {
    const { service, store } = setup(() => throwError(() => new Error('no refresh cookie')));

    await service.bootstrap();

    expect(service.profile()).toBeNull();
    expect(store.token).toBeUndefined();
    expect(service.bootstrapFailed()).toBe(true);
    expect(service.bootstrapped()).toBe(true);
  });

  it('a restored session adopts the server catalog too', async () => {
    // A reload with a live cookie is a sign-in as far as the conflict rule is concerned (ADR 0032).
    const { service, catalogSync } = setup(() => of(token));

    await service.bootstrap();

    expect(catalogSync.adopt).toHaveBeenCalledTimes(1);
  });

  it('a failed bootstrap waits for private cache purge before completing', async () => {
    const { service, sessionScope } = setup(() => throwError(() => new Error('no refresh cookie')));
    let releases = 0;
    const waiting: Array<() => void> = [];
    sessionScope.register(() => new Promise<void>((resolve) => { waiting.push(resolve); }));

    const pending = service.bootstrap();
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    expect(service.bootstrapped()).toBe(false);
    while (waiting.length) { releases += 1; waiting.shift()!(); }
    await vi.waitFor(() => {
      while (waiting.length) { releases += 1; waiting.shift()!(); }
      expect(service.bootstrapped()).toBe(true);
    });
    await pending;

    expect(releases).toBeGreaterThanOrEqual(1);
  });

  it('a failed bootstrap adopts nothing, so the browser keeps its local catalog', async () => {
    const { service, catalogSync } = setup(() => throwError(() => new Error('no refresh cookie')));

    await service.bootstrap();

    expect(catalogSync.adopt).not.toHaveBeenCalled();
  });

  it('runs the refresh round trip once, so a second call cannot re-enter it', async () => {
    const { service, client } = setup(() => of(token));

    await service.bootstrap();
    await service.bootstrap();

    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly before refresh when Web Locks are unavailable', async () => {
    removeWebLocks();
    const { service, store, client } = setup(() => of(token));

    await expect(service.bootstrap()).rejects.toThrow('authCoordinationUnavailable');

    expect(client.refresh).not.toHaveBeenCalled();
    expect(store.token).toBeUndefined();
    expect(service.profile()).toBeNull();
    expect(service.bootstrapFailed()).toBe(true);
    expect(service.bootstrapped()).toBe(true);
  });

  it('purges the session when coordination disappears after the access token was published', async () => {
    const { service, store, client } = setup(() => of(token));
    // Establishment already set the token; losing coordination mid-flight must not leave it behind.
    client.meGET.mockImplementation(() => { removeWebLocks(); return of(profile); });

    await expect(service.bootstrap()).rejects.toThrow('authCoordinationUnavailable');

    expect(store.token).toBeUndefined();
    expect(service.profile()).toBeNull();
    expect(service.bootstrapFailed()).toBe(true);
    expect(service.bootstrapped()).toBe(true);
  });

  it('holds the auth lock across the startup refresh, so a second tab cannot spend the same cookie', async () => {
    installFakeWebLocks(new SharedFakeWebLocks());
    const firstResult = new Subject<AccessTokenResponse>();
    const firstTab = setup(() => firstResult);
    const secondTab = setup(() => of(token));

    const firstBootstrap = firstTab.service.bootstrap();
    await vi.waitFor(() => expect(firstTab.client.refresh).toHaveBeenCalledTimes(1));
    const secondBootstrap = secondTab.service.bootstrap();
    await new Promise(resolve => setTimeout(resolve, 0));

    // The cookie the second tab would present is still the one the first tab is spending.
    expect(secondTab.client.refresh).not.toHaveBeenCalled();
    expect(secondTab.service.bootstrapped()).toBe(false);

    firstResult.next(token);
    firstResult.complete();
    await Promise.all([firstBootstrap, secondBootstrap]);

    expect(secondTab.client.refresh).toHaveBeenCalledTimes(1);
    expect(firstTab.service.bootstrapped()).toBe(true);
    expect(secondTab.service.bootstrapped()).toBe(true);
  });

  it('a restore superseded by a concurrent tab keeps no access token it cannot justify', async () => {
    installFakeWebLocks(new SharedFakeWebLocks());
    const firstResult = new Subject<AccessTokenResponse>();
    const secondResult = new Subject<AccessTokenResponse>();
    const firstTab = setup(() => firstResult);
    const secondTab = setup(() => secondResult);

    const firstBootstrap = firstTab.service.bootstrap();
    await vi.waitFor(() => expect(firstTab.client.refresh).toHaveBeenCalledTimes(1));
    const secondBootstrap = secondTab.service.bootstrap();
    await new Promise(resolve => setTimeout(resolve, 0));

    firstResult.next(token);
    firstResult.complete();
    await vi.waitFor(() => expect(secondTab.client.refresh).toHaveBeenCalledTimes(1));
    secondResult.next(token);
    secondResult.complete();
    await Promise.all([firstBootstrap, secondBootstrap]);

    // Each tab spent its own rotated cookie once, so neither presented the other's as a replay.
    expect(firstTab.client.refresh).toHaveBeenCalledTimes(1);
    expect(secondTab.client.refresh).toHaveBeenCalledTimes(1);
    expect(firstTab.service.bootstrapped()).toBe(true);
    expect(secondTab.service.bootstrapped()).toBe(true);
    // The generation counter is origin-wide and every establishment advances it, so two concurrent
    // restores leave the tab that publishes first superseded by the one that publishes last. These
    // tokens carry no account claim, so the loser cannot tell whose session superseded it and stays
    // superseded — the re-anchor below needs an owner it can match exactly.
    expect(secondTab.service.bootstrapFailed()).toBe(false);
    expect(secondTab.service.profile()?.username).toBe('user');
    expect(secondTab.store.token).toBe('memory-token');
    // A superseded tab reports a signed-out session, so it may not keep the token it published.
    expect(firstTab.service.bootstrapFailed()).toBe(true);
    expect(firstTab.service.profile()).toBeNull();
    expect(firstTab.store.token).toBeUndefined();
  });

  it('two tabs restoring the same account both bootstrap', async () => {
    installFakeWebLocks(new SharedFakeWebLocks());
    const firstResult = new Subject<AccessTokenResponse>();
    const secondResult = new Subject<AccessTokenResponse>();
    const firstTab = setup(() => firstResult);
    const secondTab = setup(() => secondResult);

    const firstBootstrap = firstTab.service.bootstrap();
    await vi.waitFor(() => expect(firstTab.client.refresh).toHaveBeenCalledTimes(1));
    const secondBootstrap = secondTab.service.bootstrap();
    await new Promise(resolve => setTimeout(resolve, 0));

    firstResult.next(accountToken(profile.id));
    firstResult.complete();
    await vi.waitFor(() => expect(secondTab.client.refresh).toHaveBeenCalledTimes(1));
    secondResult.next(accountToken(profile.id));
    secondResult.complete();
    await Promise.all([firstBootstrap, secondBootstrap]);

    // The peer that advanced the generation published it for the very account this tab restored, so
    // the loser of the race re-anchors onto that generation instead of reporting a signed-out session.
    for (const tab of [firstTab, secondTab]) {
      expect(tab.service.bootstrapped()).toBe(true);
      expect(tab.service.bootstrapFailed()).toBe(false);
      expect(tab.service.profile()?.username).toBe('user');
      expect(tab.store.token).toBe(accountToken(profile.id).accessToken);
    }
  });

  it('a restore superseded by a peer establishing a different account fails closed', async () => {
    installFakeWebLocks(new SharedFakeWebLocks());
    const firstResult = new Subject<AccessTokenResponse>();
    const secondResult = new Subject<AccessTokenResponse>();
    const firstTab = setup(() => firstResult);
    const secondTab = setup(() => secondResult);
    secondTab.client.meGET.mockReturnValue(of(otherProfile));

    const firstBootstrap = firstTab.service.bootstrap();
    await vi.waitFor(() => expect(firstTab.client.refresh).toHaveBeenCalledTimes(1));
    const secondBootstrap = secondTab.service.bootstrap();
    await new Promise(resolve => setTimeout(resolve, 0));

    firstResult.next(accountToken(profile.id));
    firstResult.complete();
    await vi.waitFor(() => expect(secondTab.client.refresh).toHaveBeenCalledTimes(1));
    secondResult.next(accountToken(otherProfile.id));
    secondResult.complete();
    await Promise.all([firstBootstrap, secondBootstrap]);

    // An account switch mid-restore: the generation now belongs to someone else, so this profile may
    // not be bound into it — no profile, no token, and nothing adopted into the other account's scope.
    expect(firstTab.service.bootstrapFailed()).toBe(true);
    expect(firstTab.service.profile()).toBeNull();
    expect(firstTab.store.token).toBeUndefined();
    expect(firstTab.catalogSync.adopt).not.toHaveBeenCalled();
    expect(secondTab.service.bootstrapFailed()).toBe(false);
    expect(secondTab.service.profile()?.id).toBe('u2');
  });

  it('reads an ownership record as an exact match for the current generation, and nothing else', async () => {
    const { service, coordination } = setup(() => of(accountToken(profile.id)));

    await service.bootstrap();

    expect(coordination.generation()).toBe(1);
    expect(localStorage.getItem('gones.auth.sessionOwner')).toBe('1:u1');
    expect(coordination.generationOwnedBy(profile.id)).toBe(1);
    // Every other shape a record could hold supersedes instead: another account, a record an older
    // or newer generation left behind, and anything unparseable at all.
    for (const stored of ['1:u2', 'u1', '1:u1:extra', '', '{"generation":1,"profileId":"u1"}', '0:u1', '2:u1']) {
      localStorage.setItem('gones.auth.sessionOwner', stored);
      expect(coordination.generationOwnedBy(profile.id), stored).toBeUndefined();
    }
    // A browser upgraded mid-session has a generation but no record yet, which reads as unknown.
    localStorage.removeItem('gones.auth.sessionOwner');
    expect(coordination.generationOwnedBy(profile.id)).toBeUndefined();
  });

  it('teardown removes the ownership record, so no account id outlives the session', async () => {
    const { service, store } = setup(() => of(accountToken(profile.id)));
    await service.bootstrap();
    expect(localStorage.getItem('gones.auth.sessionOwner')).toBe('1:u1');

    await service.logout();

    expect(localStorage.getItem('gones.auth.sessionOwner')).toBeNull();
    expect(localStorage.getItem('gones.auth.sessionGeneration')).toBe('2');
    expect(service.profile()).toBeNull();
    expect(store.token).toBeUndefined();
  });

  it('advances the session generation inside the same lock hold that spends the cookie', async () => {
    const result = new Subject<AccessTokenResponse>();
    const { service, coordination, client } = setup(() => result);

    const bootstrap = service.bootstrap();
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledTimes(1));
    // Queued behind the hold that spends the cookie, so it reads the generation the hold left behind.
    const probe = coordination.withLock(() => coordination.generation());
    await new Promise(resolve => setTimeout(resolve, 0));
    result.next(token);
    result.complete();
    await bootstrap;

    await expect(probe).resolves.toBe(1);
    expect(service.bootstrapFailed()).toBe(false);
  });
});
