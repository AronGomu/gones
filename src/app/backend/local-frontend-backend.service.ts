import { Injectable } from '@angular/core';
import { CalendarEventDocument, createLeague, createPlaceholderLeague, LeagueDocument, normalizeCalendarEvent, normalizeCalendarEvents, normalizeLeague, PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../domain/models';
import { logBoundaryError } from '../shared/app-logger';
import type { ApplicationBackend } from './application-backend';

interface StoredLeague extends PersistedLeague {
  updatedAt: string;
}

interface FrontendStore {
  version: 1;
  leagues: StoredLeague[];
  calendarEvents: CalendarEventDocument[];
}

const STORE_KEY = 'gones.frontend.backend.v1';
const CORRUPT_BACKUP_PREFIX = `${STORE_KEY}.corrupt`;
const DEMO_LEAGUES: StoredLeague[] = [
  { ...createPlaceholderLeague(), documentVersion: 1, updatedAt: new Date(0).toISOString() },
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
    await this.withStoreLock(() => {
      this.mutate((store) => {
        if (store.leagues.some((item) => item.id === persisted.id)) throw new Error('leagueAlreadyExists');
        return { ...store, leagues: [persisted, ...store.leagues] };
      });
    });
    return this.clone(persisted);
  }

  async saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague> {
    const normalized = normalizeLeague(league);
    let saved: StoredLeague | null = null;
    await this.withStoreLock(() => {
      this.mutate((store) => {
        const index = store.leagues.findIndex((item) => item.id === normalized.id);
        if (index === -1 || store.leagues[index].documentVersion !== expectedVersion) throw new Error('staleLeagueDocument');
        saved = this.toStoredLeague(normalized, expectedVersion + 1);
        const leagues = [...store.leagues];
        leagues[index] = saved;
        return { ...store, leagues };
      });
    });
    if (!saved) throw new Error('leagueSaveFailed');
    return this.clone(saved);
  }

  async deleteLeague(id: string): Promise<void> {
    if (id === PLACEHOLDER_LEAGUE_ID) throw new Error('placeholderLeagueCannotBeDeleted');
    await this.withStoreLock(() => {
      this.mutate((store) => ({ ...store, leagues: this.ensurePlaceholderLeague(store.leagues.filter((league) => league.id !== id)) }));
    });
  }

  async listCalendarEvents(): Promise<CalendarEventDocument[]> {
    return this.clone(this.read().calendarEvents);
  }

  async saveCalendarEvent(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    const normalized = normalizeCalendarEvent(event);
    await this.withStoreLock(() => {
      this.mutate((store) => {
        const index = store.calendarEvents.findIndex((item) => item.id === normalized.id);
        const calendarEvents = [...store.calendarEvents];
        if (index === -1) calendarEvents.push(normalized);
        else calendarEvents[index] = normalized;
        return { ...store, calendarEvents: normalizeCalendarEvents(calendarEvents) };
      });
    });
    return this.clone(normalized);
  }

  async deleteCalendarEvent(id: string): Promise<void> {
    await this.withStoreLock(() => {
      this.mutate((store) => ({ ...store, calendarEvents: store.calendarEvents.filter((event) => event.id !== id) }));
    });
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

  private async withStoreLock(callback: () => void): Promise<void> {
    const locks = navigator.locks;
    if (locks) await locks.request(STORE_KEY, callback);
    else callback();
  }

  private normalizeStore(store: Partial<FrontendStore> | null, raw: string | null): FrontendStore {
    if (!store) return this.defaultStore();
    if (!Array.isArray(store.leagues)) {
      this.backupRawStore(raw);
      return this.defaultStore();
    }
    return {
      version: 1,
      leagues: this.ensurePlaceholderLeague(store.leagues.map((league) => this.normalizeStoredLeague(league))),
      calendarEvents: normalizeCalendarEvents(store.calendarEvents)
    };
  }

  private normalizeStoredLeague(league: Partial<StoredLeague>): StoredLeague {
    const normalized = normalizeLeague(league);
    return { ...normalized, documentVersion: league.documentVersion || 1, updatedAt: league.updatedAt ?? new Date().toISOString() };
  }

  private ensurePlaceholderLeague(leagues: StoredLeague[]): StoredLeague[] {
    return leagues.some((league) => league.id === PLACEHOLDER_LEAGUE_ID)
      ? leagues
      : [{ ...createPlaceholderLeague(), documentVersion: 1, updatedAt: new Date().toISOString() }, ...leagues];
  }

  private backupRawStore(raw: string | null): void {
    if (!raw) return;
    localStorage.setItem(`${CORRUPT_BACKUP_PREFIX}.${new Date().toISOString()}`, raw);
  }

  private defaultStore(): FrontendStore {
    return { version: 1, leagues: this.clone(DEMO_LEAGUES), calendarEvents: [] };
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
