import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Client, PlayerDetailResponse } from '../../api/generated/gones-api';
import { CatalogEntry, CatalogResult, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from '../../shared/catalog-cache';

export const PLAYER_DETAIL_CACHE_PREFIX = 'gones.player.';

/**
 * One key per player, case-folded: `GET /api/players/{playerName}` resolves a name
 * case-insensitively, so two spellings of one player must not become two cached answers.
 */
export function playerDetailCacheKey(playerName: string): string {
  return `${PLAYER_DETAIL_CACHE_PREFIX}${playerName.trim().toLocaleLowerCase()}`;
}

/**
 * `items: null` is the server's answer that it knows no played Match for this player — a `404` from
 * this endpoint means both "unknown player" and "no completed match", and neither is a failure the
 * page has to render as an error: a browser-local-only player still has a local half to show.
 */
export type PlayerDetailResult = CatalogResult<PlayerDetailResponse | null>;

type StoredEntry = CatalogEntry<PlayerDetailResponse | null>;

@Injectable({ providedIn: 'root' })
export class PlayerDetailCacheService {
  private readonly client = inject(Client);

  async load(playerName: string, options: { force?: boolean } = {}): Promise<PlayerDetailResult> {
    const key = playerDetailCacheKey(playerName);
    const cached = readCatalogEntry<PlayerDetailResponse | null>(key);
    if (!options.force && cached && isCatalogFresh(cached)) {
      return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, truncated: cached.truncated };
    }
    try {
      const payload = await firstValueFrom(this.client.getPlayer(playerName)) ?? null;
      return this.store(key, payload, payload?.truncated ?? false);
    } catch (error) {
      if (isNotFound(error)) return this.store(key, null, false);
      if (cached) {
        return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: false, stale: true, truncated: cached.truncated };
      }
      throw error;
    }
  }

  private store(key: string, payload: PlayerDetailResponse | null, truncated: boolean): PlayerDetailResult {
    const fetchedAt = new Date().toISOString();
    const entry: StoredEntry = { items: payload, fetchedAt, truncated };
    writeCatalogEntry(key, entry);
    return { items: payload, fetchedAt, fromCache: false, stale: false, truncated };
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}
