import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Client, PublicDeckArchetypeResponse } from '../api/generated/gones-api';
import { DeckArchetypeSettingsService } from '../shared/deck-archetype-settings.service';
import { SessionCatalogSyncService } from './session-catalog-sync.service';

/**
 * ADR 0031 / ADR 0032 — the server catalog replaces the browser one on sign-in, and a failed fetch
 * replaces nothing. No TestBed in this repo, so the service is built with a bare `Injector` over a
 * fake `Client` and a spy settings service.
 */

function setup(listDeckArchetypes: () => ReturnType<Client['listDeckArchetypes']>) {
  const client = { listDeckArchetypes: vi.fn(listDeckArchetypes) };
  const settings = { adoptServerCatalog: vi.fn(async (_names: string[], _isCurrentSession: () => boolean) => true) };
  const injector = Injector.create({ providers: [
    { provide: Client, useValue: client },
    { provide: DeckArchetypeSettingsService, useValue: settings }
  ] });
  const service = runInInjectionContext(injector, () => new SessionCatalogSyncService());
  return { service, client, settings };
}

function archetype(name: string): PublicDeckArchetypeResponse {
  return { id: name.toLowerCase(), name };
}

describe('SessionCatalogSyncService', () => {
  it('hands the server catalog and same current-session guard to the local one', async () => {
    const { service, settings } = setup(() => of([archetype('Server A'), archetype('Server B')]));
    const isCurrentSession = () => true;

    await service.adopt('u1', isCurrentSession);

    expect(settings.adoptServerCatalog).toHaveBeenCalledWith(['Server A', 'Server B'], isCurrentSession);
  });

  it('a failed catalog fetch leaves the local catalog alone', async () => {
    const { service, settings } = setup(() => throwError(() => new Error('offline')));

    await expect(service.adopt('u1', () => true)).resolves.toBeUndefined();

    expect(settings.adoptServerCatalog).not.toHaveBeenCalled();
  });

  it('a delayed response after logout adopts nothing', async () => {
    const response = new Subject<PublicDeckArchetypeResponse[]>();
    const { service, settings } = setup(() => response);
    let current = true;
    const pending = service.adopt('u1', () => current);

    current = false;
    response.next([archetype('Server A')]);
    response.complete();
    await pending;

    expect(settings.adoptServerCatalog).not.toHaveBeenCalled();
  });

  it('a delayed response after user switch adopts nothing', async () => {
    const response = new Subject<PublicDeckArchetypeResponse[]>();
    const { service, settings } = setup(() => response);
    let currentProfileId = 'u1';
    const pending = service.adopt('u1', () => currentProfileId === 'u1');

    currentProfileId = 'u2';
    response.next([archetype('Server A')]);
    response.complete();
    await pending;

    expect(settings.adoptServerCatalog).not.toHaveBeenCalled();
  });
});
