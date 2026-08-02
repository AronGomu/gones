import { Injectable } from '@angular/core';
import { CalendarEventDocument, createLeague, createPlaceholderLeague, createRound, createTournament, defaultIdFactory, LeagueDocument, LeagueStatus, normalizeCalendarEvent, normalizeCalendarEvents, normalizeLeague, PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry } from '../domain/models';
import { restoreFullData, restoreLeague } from '../domain/export-restore';
import { importRoundEntries } from '../domain/round-import';
import { renamePlayerInLeague } from '../domain/rename-player';
import { mergeImportedRoundArchetypes, setTournamentPlayerArchetype } from '../domain/tournament-archetypes';
import { logBoundaryError } from '../shared/app-logger';
import type { ApplicationBackend, FullLeagueRestoreCommand, LeagueRestoreCommand, MoveResultTournamentResult } from './application-backend';

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

  async createLeague(name: string, _idempotencyKey?: string): Promise<PersistedLeague> {
    return this.insertLeague(createLeague({ name }));
  }

  async renameLeague(id: string, expectedVersion: number, name: string): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => ({ ...league, name: name.trim() }));
  }

  async changeLeagueStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => ({ ...league, status }));
  }

  async createResultTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => ({ ...league, tournaments: [...league.tournaments, createTournament({ leagueId: id, name, tournamentDate })] }));
  }

  async editResultTournament(id: string, tournamentId: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateTournament(league, tournamentId, tournament => ({ ...tournament, name: name.trim(), tournamentDate })));
  }

  async deleteResultTournament(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => ({ ...league, tournaments: league.tournaments.filter(tournament => tournament.id !== tournamentId) }));
  }

  async moveResultTournament(id: string, tournamentId: string, expectedVersion: number, targetLeagueId: string, targetExpectedVersion: number): Promise<MoveResultTournamentResult> {
    const source = await this.getLeague(id);
    const target = await this.getLeague(targetLeagueId);
    if (!source || !target) throw new Error('leagueNotFound');
    if (source.documentVersion !== expectedVersion || target.documentVersion !== targetExpectedVersion) throw new Error('staleLeagueDocument');
    const tournament = source.tournaments.find(item => item.id === tournamentId);
    if (!tournament) throw new Error('tournamentNotFound');
    const fromLeague = await this.saveLeague({ ...source, tournaments: source.tournaments.filter(item => item.id !== tournamentId) }, expectedVersion);
    try {
      const toLeague = await this.saveLeague({ ...target, tournaments: [...target.tournaments, { ...tournament, leagueId: targetLeagueId }] }, targetExpectedVersion);
      return { fromLeague, toLeague };
    } catch (error) {
      await this.saveLeague({ ...fromLeague, tournaments: [...fromLeague.tournaments, tournament] }, fromLeague.documentVersion);
      throw error;
    }
  }

  async addResultRound(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateTournament(league, tournamentId, tournament => ({ ...tournament, rounds: [...tournament.rounds, createRound()] })));
  }

  async deleteResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateTournament(league, tournamentId, tournament => ({ ...tournament, rounds: tournament.rounds.filter(round => round.id !== roundId) })));
  }

  async importResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedLeague> {
    const imported = importRoundEntries(text);
    return this.mutateLeague(id, expectedVersion, league => this.updateTournament(league, tournamentId, tournament => {
      const merged = mergeImportedRoundArchetypes(tournament, imported.entries);
      return { ...tournament, playerArchetypes: merged.playerArchetypes, rounds: tournament.rounds.map(round => round.id === roundId ? { ...round, entries: merged.entries } : round) };
    }));
  }

  async replaceResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateRound(league, tournamentId, roundId, round => ({ ...round, entries })));
  }

  async addResultEntry(id: string, tournamentId: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague> {
    const next = { ...entry, id: defaultIdFactory() } as RoundEntry;
    return this.mutateLeague(id, expectedVersion, league => this.updateRound(league, tournamentId, roundId, round => ({ ...round, entries: [...round.entries, next] })));
  }

  async editResultEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateRound(league, tournamentId, roundId, round => ({ ...round, entries: round.entries.map(item => item.id === entryId ? { ...entry, id: entryId } as RoundEntry : item) })));
  }

  async deleteResultEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateRound(league, tournamentId, roundId, round => ({ ...round, entries: round.entries.filter(entry => entry.id !== entryId) })));
  }

  async updateResultPlayerArchetype(id: string, tournamentId: string, playerName: string, expectedVersion: number, archetype: string): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => this.updateTournament(league, tournamentId, tournament => setTournamentPlayerArchetype(tournament, playerName, archetype)));
  }

  async renameLeaguePlayerName(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedLeague> {
    return this.mutateLeague(id, expectedVersion, league => renamePlayerInLeague(league, fromName, toName));
  }

  async restoreLeague(command: LeagueRestoreCommand, _idempotencyKey?: string): Promise<PersistedLeague> {
    const existingLeagues = await this.listLeagues();
    return this.insertLeague(restoreLeague(command, { existingLeagues }));
  }

  async restoreFullLeagueData(command: FullLeagueRestoreCommand, _idempotencyKey?: string): Promise<PersistedLeague[]> {
    const existingLeagues = await this.listLeagues();
    const restored = restoreFullData(command, { existingLeagues });
    const saved: PersistedLeague[] = [];
    for (const league of restored) saved.push(await this.insertLeague(league));
    return saved;
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

  async deleteLeague(id: string, expectedVersion: number): Promise<void> {
    if (id === PLACEHOLDER_LEAGUE_ID) throw new Error('placeholderLeagueCannotBeDeleted');
    await this.withStoreLock(() => {
      this.mutate((store) => {
        const existing = store.leagues.find(league => league.id === id);
        if (!existing || existing.documentVersion !== expectedVersion) throw new Error('staleLeagueDocument');
        return { ...store, leagues: this.ensurePlaceholderLeague(store.leagues.filter((league) => league.id !== id)) };
      });
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

  private async mutateLeague(id: string, expectedVersion: number, update: (league: PersistedLeague) => LeagueDocument): Promise<PersistedLeague> {
    const league = await this.getLeague(id);
    if (!league) throw new Error('leagueNotFound');
    return this.saveLeague(update(league), expectedVersion);
  }

  private updateTournament(league: LeagueDocument, tournamentId: string, update: (tournament: LeagueDocument['tournaments'][number]) => LeagueDocument['tournaments'][number]): LeagueDocument {
    if (!league.tournaments.some(tournament => tournament.id === tournamentId)) throw new Error('tournamentNotFound');
    return { ...league, tournaments: league.tournaments.map(tournament => tournament.id === tournamentId ? update(tournament) : tournament) };
  }

  private updateRound(league: LeagueDocument, tournamentId: string, roundId: string, update: (round: LeagueDocument['tournaments'][number]['rounds'][number]) => LeagueDocument['tournaments'][number]['rounds'][number]): LeagueDocument {
    return this.updateTournament(league, tournamentId, tournament => {
      if (!tournament.rounds.some(round => round.id === roundId)) throw new Error('roundNotFound');
      return { ...tournament, rounds: tournament.rounds.map(round => round.id === roundId ? update(round) : round) };
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
