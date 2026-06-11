import { Injectable } from '@angular/core';
import { createLiveTournament, LiveTournamentDocument, normalizeLiveTournament } from '../domain/live-tournament';
import { logBoundaryError } from '../shared/app-logger';

interface LiveTournamentStore {
  version: 1;
  tournaments: LiveTournamentDocument[];
  deletedTournamentIds: string[];
}

const STORE_KEY = 'gones.live-tournaments.v1';
const CORRUPT_BACKUP_PREFIX = `${STORE_KEY}.corrupt`;

@Injectable({ providedIn: 'root' })
export class LiveTournamentRepository {
  async list(): Promise<LiveTournamentDocument[]> {
    return this.clone(this.read().tournaments).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<LiveTournamentDocument | null> {
    return this.clone(this.read().tournaments.find((tournament) => tournament.id === id) ?? null);
  }

  async create(): Promise<LiveTournamentDocument> {
    const tournament = createLiveTournament();
    await this.save(tournament);
    return this.clone(tournament);
  }

  async save(tournament: LiveTournamentDocument): Promise<LiveTournamentDocument> {
    return this.withStoreLock(async () => {
      const incoming = normalizeLiveTournament(tournament);
      let saved: LiveTournamentDocument | null = null;
      this.mutate((store) => {
        const existingIndex = store.tournaments.findIndex((item) => item.id === incoming.id);
        const tournaments = [...store.tournaments];
        if (existingIndex === -1) {
          if (store.deletedTournamentIds.includes(incoming.id)) throw new Error('deletedLiveTournamentDocument');
          saved = normalizeLiveTournament({ ...incoming, documentVersion: 1, updatedAt: new Date().toISOString() });
          tournaments.unshift(saved);
        } else {
          const existing = tournaments[existingIndex];
          if (incoming.documentVersion !== existing.documentVersion) throw new Error('staleLiveTournamentDocument');
          saved = normalizeLiveTournament({ ...incoming, documentVersion: existing.documentVersion + 1, updatedAt: new Date().toISOString() });
          tournaments[existingIndex] = saved;
        }
        return { ...store, tournaments };
      });
      if (!saved) throw new Error('liveTournamentSaveFailed');
      return this.clone(saved);
    });
  }

  async delete(id: string): Promise<void> {
    await this.withStoreLock(() => {
      this.mutate((store) => ({
        ...store,
        tournaments: store.tournaments.filter((tournament) => tournament.id !== id),
        deletedTournamentIds: store.deletedTournamentIds.includes(id) ? store.deletedTournamentIds : [...store.deletedTournamentIds, id]
      }));
    });
  }

  private async withStoreLock<T>(callback: () => T): Promise<T> {
    const locks = navigator.locks;
    return locks ? locks.request(STORE_KEY, callback) : callback();
  }

  private read(): LiveTournamentStore {
    const raw = localStorage.getItem(STORE_KEY);
    try {
      const parsed = JSON.parse(raw ?? 'null') as Partial<LiveTournamentStore> | null;
      return this.normalizeStore(parsed, raw);
    } catch (error) {
      logBoundaryError('live-tournament-repository.read', error, { hasRaw: Boolean(raw) });
      this.backupRawStore(raw);
      return this.defaultStore();
    }
  }

  private mutate(update: (store: LiveTournamentStore) => LiveTournamentStore): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(update(this.read())));
  }

  private normalizeStore(store: Partial<LiveTournamentStore> | null, raw: string | null): LiveTournamentStore {
    if (!store) return this.defaultStore();
    if (!Array.isArray(store.tournaments)) {
      this.backupRawStore(raw);
      return this.defaultStore();
    }
    return {
      version: 1,
      tournaments: store.tournaments.map((tournament) => normalizeLiveTournament(tournament)),
      deletedTournamentIds: Array.isArray(store.deletedTournamentIds) ? store.deletedTournamentIds.filter((id) => typeof id === 'string') : []
    };
  }

  private backupRawStore(raw: string | null): void {
    if (!raw) return;
    localStorage.setItem(`${CORRUPT_BACKUP_PREFIX}.${new Date().toISOString()}`, raw);
  }

  private defaultStore(): LiveTournamentStore {
    return { version: 1, tournaments: [], deletedTournamentIds: [] };
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
