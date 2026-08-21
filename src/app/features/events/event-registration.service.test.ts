import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '../../api/generated/gones-api';
import { SessionScopeService } from '../../auth/session-scope.service';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { REGISTRATION_ONLINE, RegistrationOfflineError, EventRegistrationService, registrationErrorKey } from './event-registration.service';
import { REGISTRATIONS_CACHE_FAMILY } from './my-registrations';

describe('EventRegistrationService', () => {
  it('keeps one Idempotency-Key through network retry then rotates after success', async () => {
    const registerForEvent = vi.fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })))
      .mockReturnValueOnce(of({ attemptId: 'attempt', eventId: 'event', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }))
      .mockReturnValueOnce(of({ attemptId: 'attempt-2', eventId: 'event', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }));
    const service = createService({ registerForEvent });

    await expect(service.register('event')).rejects.toBeInstanceOf(HttpErrorResponse);
    await expect(service.register('event')).resolves.toMatchObject({ status: 'Confirmed' });
    await expect(service.register('event')).resolves.toMatchObject({ status: 'Confirmed' });

    expect(registerForEvent.mock.calls[0][1]).toBe(registerForEvent.mock.calls[1][1]);
    expect(registerForEvent.mock.calls[2][1]).not.toBe(registerForEvent.mock.calls[1][1]);
  });

  it('rejects offline writes before dispatch without optimistic state', async () => {
    const registerForEvent = vi.fn();
    const service = createService({ registerForEvent }, false);

    await expect(service.register('event')).rejects.toBeInstanceOf(RegistrationOfflineError);
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it('drops in-flight idempotency keys when the session ends', async () => {
    const registerForEvent = vi.fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })))
      .mockReturnValueOnce(of({ attemptId: 'attempt', eventId: 'event', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }));
    const sessionScope = new SessionScopeService();
    const service = createService({ registerForEvent }, true, sessionScope);

    await expect(service.register('event')).rejects.toBeInstanceOf(HttpErrorResponse);
    sessionScope.clear();
    await expect(service.register('event')).resolves.toMatchObject({ status: 'Confirmed' });

    expect(registerForEvent.mock.calls[1][1]).not.toBe(registerForEvent.mock.calls[0][1]);
  });

  /**
   * ADR 0039: My Registrations caches every page it reads for 24h, so a registration written here
   * that did not drop those rows stayed invisible on that page for a day. Deleting the two
   * `invalidateFamily` calls fails these three.
   */
  it('drops every cached My Registrations page after a register', async () => {
    const cache = fakeCache();
    const registerForEvent = vi.fn().mockReturnValue(of({ attemptId: 'a', eventId: 'event', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }));
    const service = createService({ registerForEvent }, true, new SessionScopeService(), cache);

    await service.register('event');

    expect(cache.invalidateFamily).toHaveBeenCalledWith(REGISTRATIONS_CACHE_FAMILY);
  });

  it('drops every cached My Registrations page after an unregister', async () => {
    const cache = fakeCache();
    const unregisterFromEvent = vi.fn().mockReturnValue(of({ attemptId: 'a', eventId: 'event', userId: 'user', status: 'CancelledByUser', registeredAt: '2030-01-01T00:00:00Z' }));
    const service = createService({ unregisterFromEvent } as Partial<Client>, true, new SessionScopeService(), cache);

    await service.unregister('event');

    expect(cache.invalidateFamily).toHaveBeenCalledWith(REGISTRATIONS_CACHE_FAMILY);
  });

  it('keeps the cache when the write failed', async () => {
    const cache = fakeCache();
    const registerForEvent = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    const service = createService({ registerForEvent }, true, new SessionScopeService(), cache);

    await expect(service.register('event')).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(cache.invalidateFamily).not.toHaveBeenCalled();
  });

  it('maps stable server reasons to specific UX copy', () => {
    expect(registrationErrorKey('email_verification_required')).toBe('registration.emailVerificationRequired');
    expect(registrationErrorKey('registration_blocked')).toBe('registration.blocked');
    expect(registrationErrorKey('event_full')).toBe('registration.full');
    expect(registrationErrorKey('registration_closed')).toBe('registration.started');
    expect(registrationErrorKey('unknown')).toBe('registration.failed');
  });
});

function fakeCache() {
  return { invalidateFamily: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined) };
}

function createService(
  client: Partial<Client>,
  online = true,
  sessionScope = new SessionScopeService(),
  cache: ReturnType<typeof fakeCache> = fakeCache()
): EventRegistrationService {
  const injector = Injector.create({ providers: [
    EventRegistrationService,
    { provide: Client, useValue: client },
    { provide: SessionScopeService, useValue: sessionScope },
    { provide: ServerReadCacheService, useValue: cache },
    { provide: REGISTRATION_ONLINE, useValue: () => online }
  ] });
  return injector.get(EventRegistrationService);
}
