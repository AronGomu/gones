import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { Client, PlayerDetailResponse } from '../../api/generated/gones-api';
import { PLAYER_DETAIL_CACHE_PREFIX, PlayerDetailCacheService, playerDetailCacheKey } from './player-detail-cache.service';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; }
  } as Storage;
}

function payload(overrides: Partial<PlayerDetailResponse> = {}): PlayerDetailResponse {
  return {
    statistics: {
      position: 1, playerName: 'Alice', playedMatchCount: 3, matchWins: 2, matchLosses: 1, matchDraws: 0,
      matchWinrate: 2 / 3, playedGameCount: 6, gameWins: 4, gameLosses: 2, gameWinrate: 2 / 3,
      nemesis: undefined, rival: undefined, mostPlayedArchetype: undefined,
      rating: 1500, ratingDeviation: 350, previousRating: 1500, lastRatingDelta: 0,
      tournamentsPlayed: 1, lastPlayedDate: '2026-01-01', provisional: true, inactive: false,
      decayedRating: undefined
    },
    matches: [],
    totalMatchCount: 3,
    truncated: false,
    ...overrides
  };
}

function buildService(getPlayer: ReturnType<typeof vi.fn>): PlayerDetailCacheService {
  const injector = Injector.create({ providers: [
    PlayerDetailCacheService,
    { provide: Client, useValue: { getPlayer } }
  ] });
  return injector.get(PlayerDetailCacheService);
}

/** The generated client rejects with an `ApiException`-shaped object carrying the status. */
function apiError(status: number): unknown {
  return { status, message: `HTTP ${status}`, isApiException: true };
}

describe('PlayerDetailCacheService', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage();
  });

  it('keys one entry per player, case-folded', () => {
    expect(playerDetailCacheKey('Demo Player 06')).toBe(`${PLAYER_DETAIL_CACHE_PREFIX}demo player 06`);
    expect(playerDetailCacheKey('  demo player 06 ')).toBe(playerDetailCacheKey('Demo Player 06'));
    expect(playerDetailCacheKey('Alice')).not.toBe(playerDetailCacheKey('Bob'));
  });

  it('fetches when the cache is empty and stores the payload', async () => {
    const getPlayer = vi.fn().mockReturnValue(of(payload()));
    const service = buildService(getPlayer);

    const result = await service.load('Alice');

    expect(getPlayer).toHaveBeenCalledWith('Alice');
    expect(result.fromCache).toBe(false);
    expect(result.items?.statistics.playedMatchCount).toBe(3);
    expect(globalThis.localStorage!.getItem(playerDetailCacheKey('Alice'))).toContain('playedMatchCount');
  });

  it('serves a cache written an hour ago without calling the API', async () => {
    globalThis.localStorage!.setItem(playerDetailCacheKey('Alice'), JSON.stringify({
      items: payload(), fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const getPlayer = vi.fn();
    const service = buildService(getPlayer);

    const result = await service.load('Alice');

    expect(result.fromCache).toBe(true);
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it('refetches a cache written 25 hours ago', async () => {
    globalThis.localStorage!.setItem(playerDetailCacheKey('Alice'), JSON.stringify({
      items: payload(), fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const getPlayer = vi.fn().mockReturnValue(of(payload()));
    const service = buildService(getPlayer);

    const result = await service.load('Alice');

    expect(result.fromCache).toBe(false);
    expect(getPlayer).toHaveBeenCalledTimes(1);
  });

  it('caches each player under its own key', async () => {
    const getPlayer = vi.fn().mockReturnValue(of(payload()));
    const service = buildService(getPlayer);

    await service.load('Alice');
    await service.load('Bob');

    expect(globalThis.localStorage!.getItem(playerDetailCacheKey('Alice'))).not.toBeNull();
    expect(globalThis.localStorage!.getItem(playerDetailCacheKey('Bob'))).not.toBeNull();
    expect(getPlayer).toHaveBeenCalledTimes(2);
  });

  it('forces a refetch past a fresh cache', async () => {
    globalThis.localStorage!.setItem(playerDetailCacheKey('Alice'), JSON.stringify({
      items: payload(), fetchedAt: new Date().toISOString(), truncated: false
    }));
    const getPlayer = vi.fn().mockReturnValue(of(payload()));
    const service = buildService(getPlayer);

    const result = await service.load('Alice', { force: true });

    expect(result.fromCache).toBe(false);
    expect(getPlayer).toHaveBeenCalledTimes(1);
  });

  it('reads a 404 as an empty payload, not an error', async () => {
    const getPlayer = vi.fn().mockReturnValue(throwError(() => apiError(404)));
    const service = buildService(getPlayer);

    const result = await service.load('Nobody');

    expect(result.items).toBeNull();
    expect(result.stale).toBe(false);
    expect(globalThis.localStorage!.getItem(playerDetailCacheKey('Nobody'))).not.toBeNull();
  });

  it('reports the truncation flag the server sent', async () => {
    const getPlayer = vi.fn().mockReturnValue(of(payload({ truncated: true, totalMatchCount: 6000 })));
    const service = buildService(getPlayer);

    expect((await service.load('Alice')).truncated).toBe(true);
  });

  it('falls back to a stale cache when the server cannot be reached', async () => {
    globalThis.localStorage!.setItem(playerDetailCacheKey('Alice'), JSON.stringify({
      items: payload(), fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const getPlayer = vi.fn().mockReturnValue(throwError(() => apiError(0)));
    const service = buildService(getPlayer);

    const result = await service.load('Alice');

    expect(result.items?.statistics.playerName).toBe('Alice');
    expect(result.stale).toBe(true);
  });

  it('rethrows a failure with nothing cached', async () => {
    const getPlayer = vi.fn().mockReturnValue(throwError(() => apiError(500)));
    const service = buildService(getPlayer);

    await expect(service.load('Alice')).rejects.toMatchObject({ status: 500 });
  });
});
