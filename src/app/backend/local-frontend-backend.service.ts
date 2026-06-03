import { Injectable } from '@angular/core';
import { createLeague, LeagueDocument, normalizeLeague, PersistedLeague } from '../domain/models';
import { logBoundaryError } from '../shared/app-logger';
import type { ApplicationBackend } from './application-backend';

interface StoredLeague extends PersistedLeague {
  updatedAt: string;
}

interface FrontendStore {
  version: 1;
  leagues: StoredLeague[];
}

const STORE_KEY = 'gones.frontend.backend.v1';
const CORRUPT_BACKUP_PREFIX = `${STORE_KEY}.corrupt`;
const DEMO_LEAGUES: StoredLeague[] = [
  { ...createLeague({ id: 'demo-league', name: 'Demo League', status: 'active', tournaments: [] }), documentVersion: 1, updatedAt: new Date(0).toISOString() }
];

@Injectable({ providedIn: 'root' })
export class LocalFrontendBackend implements ApplicationBackend {
  readonly mode = 'frontend-local' as const;
  readonly configured = true;

  async listLeagues(): Promise<PersistedLeague[]> {
    return this.clone(this.read().leagues).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    return this.clone(this.read().leagues.find((league) => league.id === id) ?? null);
  }

  async createLeague(name: string): Promise<PersistedLeague> {
    return this.insertLeague(createLeague({ name }));
  }

  async insertLeague(league: LeagueDocument): Promise<PersistedLeague> {
    const persisted = this.toStoredLeague(league, 1);
    this.mutate((store) => {
      if (store.leagues.some((item) => item.id === persisted.id)) throw new Error('leagueAlreadyExists');
      return { ...store, leagues: [persisted, ...store.leagues] };
    });
    return this.clone(persisted);
  }

  async saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague> {
    const normalized = normalizeLeague(league);
    let saved: StoredLeague | null = null;
    this.mutate((store) => {
      const index = store.leagues.findIndex((item) => item.id === normalized.id);
      if (index === -1 || store.leagues[index].documentVersion !== expectedVersion) throw new Error('staleLeagueDocument');
      saved = this.toStoredLeague(normalized, expectedVersion + 1);
      const leagues = [...store.leagues];
      leagues[index] = saved;
      return { ...store, leagues };
    });
    if (!saved) throw new Error('leagueSaveFailed');
    return this.clone(saved);
  }

  async deleteLeague(id: string): Promise<void> {
    this.mutate((store) => ({ ...store, leagues: store.leagues.filter((league) => league.id !== id) }));
  }

  private toStoredLeague(league: LeagueDocument, documentVersion: number): StoredLeague {
    return { ...normalizeLeague(league), documentVersion, updatedAt: new Date().toISOString() };
  }

  private read(): FrontendStore {
    const raw = localStorage.getItem(STORE_KEY);
    try {
      const parsed = JSON.parse(raw ?? 'null') as Partial<FrontendStore> | null;
      return this.normalizeStore(parsed, raw);
    } catch (error) {
      logBoundaryError('local-frontend-backend.read', error, { hasRaw: Boolean(raw) });
      this.backupRawStore(raw);
      return this.defaultStore();
    }
  }

  private mutate(update: (store: FrontendStore) => FrontendStore): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(update(this.read())));
  }

  private normalizeStore(store: Partial<FrontendStore> | null, raw: string | null): FrontendStore {
    if (!store) return this.defaultStore();
    if (!Array.isArray(store.leagues)) {
      this.backupRawStore(raw);
      return this.defaultStore();
    }
    return {
      version: 1,
      leagues: store.leagues.map((league) => this.normalizeStoredLeague(league))
    };
  }

  private normalizeStoredLeague(league: Partial<StoredLeague>): StoredLeague {
    const normalized = normalizeLeague(league);
    return { ...normalized, documentVersion: league.documentVersion || 1, updatedAt: league.updatedAt ?? new Date().toISOString() };
  }

  private backupRawStore(raw: string | null): void {
    if (!raw) return;
    localStorage.setItem(`${CORRUPT_BACKUP_PREFIX}.${new Date().toISOString()}`, raw);
  }

  private defaultStore(): FrontendStore {
    return { version: 1, leagues: this.clone(DEMO_LEAGUES) };
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
