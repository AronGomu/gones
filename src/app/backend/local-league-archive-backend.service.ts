import { Injectable } from '@angular/core';
import { isLocalLeagueId, LOCAL_PLACEHOLDER_LEAGUE_ID, newLocalLeagueId } from '../data/league-archive-origin';
import {
  createLeague,
  isPlaceholderLeagueId,
  normalizeLeague,
  LeagueDocument,
  LeagueStatus,
  PersistedLeague,
  PLACEHOLDER_LEAGUE_NAME
} from '../domain/models';
import { get, getAll, openDatabase, put, remove } from './indexed-db';
import type { FullLeagueRestoreCommand, LeagueArchiveBackendPort, LeagueRestoreCommand } from './application-backend';

/**
 * Browser-local League authority (ADR 0028) — the League half of the browser-local store, next to
 * the Live one (ADR 0021). Nothing here talks to the network: there is no HTTP dependency to talk
 * with, and nothing is ever synchronised in either direction. A league belongs to this store for its
 * whole life, and its `local-` id prefix is the whole routing rule.
 *
 * Every rule lives in `src/app/domain/models.ts`. This adapter only loads a document, hands it to a
 * pure domain function, guards the version and writes the result back.
 */
export const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';
export const LOCAL_LEAGUE_STORE = 'leagues';
const LOCAL_LEAGUE_DB_VERSION = 1;

/**
 * Stale-write rejection with the shape `league-archive-command-ux.ts` already classifies as `stale`:
 * it keys on `status === 412` first and on this exact message second, so both authorities produce the
 * identical "reload the latest document and reapply" conflict UX.
 */
export class LeagueConcurrencyError extends Error {
  readonly status = 412;

  constructor() {
    super('staleLeagueDocument');
    this.name = 'LeagueConcurrencyError';
  }
}

@Injectable({ providedIn: 'root' })
export class LocalLeagueArchiveBackend implements Partial<LeagueArchiveBackendPort> {
  private database?: Promise<IDBDatabase>;

  async listLeagueArchives(): Promise<PersistedLeague[]> {
    const database = await this.open();
    await this.ensurePlaceholder(database);
    const rows = await getAll<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE);
    return rows
      .map((row) => this.persist(row))
      .sort((left, right) => placeholderRank(left) - placeholderRank(right) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }

  async getLeagueArchive(id: string): Promise<PersistedLeague | null> {
    const stored = await get<Partial<PersistedLeague>>(await this.open(), LOCAL_LEAGUE_STORE, id);
    return stored ? this.persist(stored) : null;
  }

  async createLeagueArchive(name: string): Promise<PersistedLeague> {
    const created: PersistedLeague = {
      ...createLeague({ id: newLocalLeagueId(), name }),
      documentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    await put(await this.open(), LOCAL_LEAGUE_STORE, created);
    return created;
  }

  renameLeagueArchive(id: string, expectedVersion: number, name: string): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({ ...league, name }));
  }

  changeLeagueArchiveStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({ ...league, status }));
  }

  async deleteLeagueArchive(id: string, expectedVersion: number): Promise<void> {
    const database = await this.open();
    const current = await this.require(database, id);
    if (current.documentVersion !== expectedVersion) throw new LeagueConcurrencyError();
    await remove(database, LOCAL_LEAGUE_STORE, id);
  }

  restoreLeagueArchive(command: LeagueRestoreCommand): Promise<PersistedLeague> {
    return this.putRestored(command.league);
  }

  async restoreFullLeagueArchiveData(command: FullLeagueRestoreCommand): Promise<PersistedLeague[]> {
    const restored: PersistedLeague[] = [];
    for (const league of command.leagues) restored.push(await this.putRestored(league));
    return restored;
  }

  /**
   * Load, guard the version, apply one pure domain transform, bump and persist. Every write path in
   * this adapter goes through here, so the optimistic-concurrency rule has exactly one home.
   */
  private async mutate(id: string, expectedVersion: number, change: (league: PersistedLeague) => LeagueDocument): Promise<PersistedLeague> {
    const database = await this.open();
    const current = await this.require(database, id);
    if (current.documentVersion !== expectedVersion) throw new LeagueConcurrencyError();
    const next: PersistedLeague = {
      ...normalizeLeague(change(current)),
      id: current.id,
      documentVersion: current.documentVersion + 1,
      updatedAt: new Date().toISOString()
    };
    await put(database, LOCAL_LEAGUE_STORE, next);
    return next;
  }

  /**
   * A restored league keeps its content and loses its origin: an id from the server namespace is
   * rewritten into this one, so a bundle exported while signed in cannot collide with what is
   * already here. The server placeholder maps onto the local placeholder rather than becoming a
   * second "Unassigned Tournaments" row.
   */
  private async putRestored(league: LeagueDocument): Promise<PersistedLeague> {
    const targetId = isPlaceholderLeagueId(league.id) || league.id === LOCAL_PLACEHOLDER_LEAGUE_ID
      ? LOCAL_PLACEHOLDER_LEAGUE_ID
      : isLocalLeagueId(league.id) ? league.id : newLocalLeagueId();
    const restored: PersistedLeague = {
      ...createLeague({ ...league, id: targetId }),
      documentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    await put(await this.open(), LOCAL_LEAGUE_STORE, restored);
    return restored;
  }

  /**
   * The local placeholder is a distinct row from the server's fixed `placeholder-league`, so
   * `createLeague` does not recognise its id and does not force the canonical name — this adapter
   * sets it, here and nowhere else.
   */
  private async ensurePlaceholder(database: IDBDatabase): Promise<void> {
    const stored = await get<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE, LOCAL_PLACEHOLDER_LEAGUE_ID);
    if (stored) return;
    const placeholder: PersistedLeague = {
      ...createLeague({ id: LOCAL_PLACEHOLDER_LEAGUE_ID, name: PLACEHOLDER_LEAGUE_NAME, status: 'active', tournaments: [] }),
      documentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    await put(database, LOCAL_LEAGUE_STORE, placeholder);
  }

  private async require(database: IDBDatabase, id: string): Promise<PersistedLeague> {
    const stored = await get<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE, id);
    if (!stored) throw new Error('leagueNotFound');
    return this.persist(stored);
  }

  private persist(row: Partial<PersistedLeague>): PersistedLeague {
    return { ...normalizeLeague(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt };
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = openDatabase(LOCAL_LEAGUE_DB_NAME, LOCAL_LEAGUE_DB_VERSION, (database) => {
        if (!database.objectStoreNames.contains(LOCAL_LEAGUE_STORE)) database.createObjectStore(LOCAL_LEAGUE_STORE, { keyPath: 'id' });
      }).catch((error: unknown) => {
        this.database = undefined; // never memoize a failed open: a later call must retry
        throw error;
      });
    }
    return this.database;
  }
}

/** The unassigned league leads the list, exactly like the server list does. */
function placeholderRank(league: PersistedLeague): number {
  return league.id === LOCAL_PLACEHOLDER_LEAGUE_ID ? 0 : 1;
}
