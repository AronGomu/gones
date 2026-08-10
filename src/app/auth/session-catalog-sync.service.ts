import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Client } from '../api/generated/gones-api';
import { logBoundaryError } from '../shared/app-logger';
import { DeckArchetypeSettingsService } from '../shared/deck-archetype-settings.service';

/**
 * Pulls the server deck-archetype catalog once per session and lets it overwrite the local one
 * (ADR 0031, ADR 0032). Remote prevails: the browser list is replaced, never merged, and nothing
 * local is ever uploaded — this is a read, in one direction only.
 *
 * A failed fetch changes nothing, so signing in offline keeps whatever this browser already had.
 * `AuthService` calls this service, so this service must never inject `AuthService` back: the public
 * `GET /api/deck-archetypes` needs no identity beyond the token the interceptor already attaches.
 */
@Injectable({ providedIn: 'root' })
export class SessionCatalogSyncService {
  private readonly client = inject(Client);
  private readonly settings = inject(DeckArchetypeSettingsService);

  async adopt(): Promise<void> {
    try {
      const archetypes = await firstValueFrom(this.client.listDeckArchetypes());
      await this.settings.adoptServerCatalog(archetypes.map((archetype) => archetype.name));
    } catch (error) {
      logBoundaryError('session-catalog-sync.adopt', error);
    }
  }
}
