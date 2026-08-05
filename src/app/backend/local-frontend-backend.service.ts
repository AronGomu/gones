import { Injectable } from '@angular/core';
import { CalendarEventDocument, createLeague, createPlaceholderLeague, createRound, createTournament, defaultIdFactory, LeagueDocument, LeagueStatus, normalizeCalendarEvent, normalizeCalendarEvents, normalizeLeague, PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, trimPlayerName } from '../domain/models';
import { restoreFullData, restoreLeague } from '../domain/export-restore';
import { importRoundEntries } from '../domain/round-import';
import { renamePlayerInLeague } from '../domain/rename-player';
import { mergeImportedRoundArchetypes, setTournamentPlayerArchetype } from '../domain/tournament-archetypes';
import {
  autoLiveSwissRoundCount,
  cancelCurrentSwissRound,
  createLiveTournament,
  createLiveTournamentPlayer,
  finalizeLiveTournament as buildFinalizedTournament,
  generateNextSwissRound,
  liveMatchScoreIssue,
  LiveTournamentDocument,
  normalizeLiveTournament,
  regenerateCurrentSwissRound,
  restoreLiveTournamentCheckpoint,
  updateLiveRoundEntryResult,
  validateCurrentSwissRound
} from '../domain/live-tournament';
import { logBoundaryError } from '../shared/app-logger';
import type { ApplicationBackend, FullLeagueRestoreCommand, LeagueRestoreCommand, LiveFinalizeResult, LivePlayerCommand, LiveScoreCommand, LiveSettingsCommand, MoveResultTournamentResult } from './application-backend';

interface StoredLeague extends PersistedLeague {
  updatedAt: string;
}

interface FrontendStore {
  version: 1;
  leagues: StoredLeague[];
  calendarEvents: CalendarEventDocument[];
}

interface LiveTournamentStore {
  version: 1;
  tournaments: LiveTournamentDocument[];
  deletedTournamentIds: string[];
}

const STORE_KEY = 'gones.frontend.backend.v1';
const CORRUPT_BACKUP_PREFIX = `${STORE_KEY}.corrupt`;
const LIVE_STORE_KEY = 'gones.live-tournaments.v1';
const LIVE_CORRUPT_BACKUP_PREFIX = `${LIVE_STORE_KEY}.corrupt`;
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

  async listLiveTournaments(): Promise<LiveTournamentDocument[]> {
    return this.clone(this.readLiveStore().tournaments).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getLiveTournament(id: string): Promise<LiveTournamentDocument | null> {
    return this.clone(this.readLiveStore().tournaments.find((tournament) => tournament.id === id) ?? null);
  }

  async createLiveTournament(tournamentDate: string, _idempotencyKey?: string): Promise<LiveTournamentDocument> {
    const tournament = createLiveTournament(tournamentDate ? { tournamentDate } : {});
    await this.saveLiveTournament(tournament);
    return this.clone(tournament);
  }

  async deleteLiveTournament(id: string, _expectedVersion: number): Promise<void> {
    await this.withLiveStoreLock(() => {
      this.mutateLiveStore((store) => ({
        ...store,
        tournaments: store.tournaments.filter((tournament) => tournament.id !== id),
        deletedTournamentIds: store.deletedTournamentIds.includes(id) ? store.deletedTournamentIds : [...store.deletedTournamentIds, id]
      }));
    });
  }

  updateLiveSettings(id: string, expectedVersion: number, settings: LiveSettingsCommand): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => this.withAutomaticLiveRoundCount({ ...live, ...settings }));
  }

  addLivePlayer(id: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      if (live.stage !== 'registration' && live.stage !== 'standings') throw new Error('livePlayerStageLocked');
      const name = trimPlayerName(player.name);
      if (!name) throw new Error('livePlayerNameRequired');
      if (this.livePlayerNameExists(live, name)) throw new Error('livePlayerAlreadyRegistered');
      const created = createLiveTournamentPlayer({ ...player, name });
      return this.withAutomaticLiveRoundCount({
        ...live,
        players: live.stage === 'registration' ? [created, ...live.players] : [...live.players, created]
      });
    });
  }

  editLivePlayer(id: string, playerId: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      const existing = live.players.find((item) => item.id === playerId);
      if (!existing) throw new Error('livePlayerNotFound');
      const nextName = trimPlayerName(player.name);
      if (nextName && live.players.some((item) => item.id !== playerId && trimPlayerName(item.name).toLowerCase() === nextName.toLowerCase())) {
        throw new Error('livePlayerNamesMustBeUnique');
      }
      const players = live.players.map((item) => item.id === playerId
        ? { ...item, ...player, name: nextName || item.name, archetype: String(player.archetype ?? '').trim() }
        : item);
      const rounds = !nextName || nextName === existing.name ? live.rounds : this.renameLiveRoundEntries(live.rounds, existing.name, nextName);
      return this.withAutomaticLiveRoundCount({ ...live, players, rounds });
    });
  }

  setLivePlayerPaid(id: string, playerId: string, expectedVersion: number, paid: boolean): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      if (live.stage === 'round') throw new Error('livePaidLockedDuringRound');
      if (!live.players.some((item) => item.id === playerId)) throw new Error('livePlayerNotFound');
      return { ...live, players: live.players.map((item) => item.id === playerId ? { ...item, paid } : item) };
    });
  }

  dropLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      if (live.stage !== 'standings') throw new Error('livePlayerDropStageLocked');
      const player = live.players.find((item) => item.id === playerId);
      if (!player) throw new Error('livePlayerNotFound');
      if (player.dropped) throw new Error('livePlayerAlreadyDropped');
      return { ...live, players: live.players.map((item) => item.id === playerId ? { ...item, dropped: true } : item) };
    });
  }

  removeLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      const player = live.players.find((item) => item.id === playerId);
      if (!player) throw new Error('livePlayerNotFound');
      const removed = { ...live, players: live.players.filter((item) => item.id !== playerId) };
      if (live.stage === 'registration') return this.withAutomaticLiveRoundCount(removed);
      if (live.stage === 'standings' && !this.livePlayerHasRoundEntry(live, player.name)) return removed;
      throw new Error('livePlayerHasRoundEntries');
    });
  }

  startLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      if (live.stage !== 'registration' && live.stage !== 'standings') throw new Error('liveRoundAlreadyOpen');
      const prepared = this.withAutomaticLiveRoundCount(live);
      const result = generateNextSwissRound(prepared);
      if (result === prepared) throw new Error('liveRoundUnavailable');
      return result;
    });
  }

  regenerateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      const result = regenerateCurrentSwissRound(live);
      if (result === live) throw new Error('liveNoOpenRound');
      return result;
    });
  }

  cancelLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      const result = live.stage === 'round' ? cancelCurrentSwissRound(live) : live;
      if (result === live) throw new Error('liveNoOpenRound');
      return result;
    });
  }

  validateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      const result = live.stage === 'round' ? validateCurrentSwissRound(live) : live;
      if (result === live) throw new Error('liveRoundIncomplete');
      return result;
    });
  }

  scoreLiveRoundEntry(id: string, roundId: string, entryId: string, expectedVersion: number, score: LiveScoreCommand): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      if (live.stage !== 'round') throw new Error('liveNoOpenRound');
      const round = live.rounds.find((item) => item.id === roundId);
      if (!round) throw new Error('liveRoundNotFound');
      if (round.validated || round.roundNumber !== live.currentRoundNumber) throw new Error('liveRoundNotEditable');
      const entry = round.entries.find((item) => item.entry.id === entryId);
      if (!entry) throw new Error('liveEntryNotFound');
      if (entry.entry.kind !== 'match') throw new Error('liveEntryNotMatch');
      const issue = liveMatchScoreIssue({ ...entry.entry, player1Score: score.player1Score, player2Score: score.player2Score });
      if (issue) throw new Error('liveScoreInvalid');
      return updateLiveRoundEntryResult(live, roundId, entryId, score);
    });
  }

  restoreLiveCheckpoint(id: string, checkpointId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutateLiveTournament(id, expectedVersion, (live) => {
      if (!live.checkpoints.some((item) => item.id === checkpointId)) throw new Error('liveCheckpointNotFound');
      const result = restoreLiveTournamentCheckpoint(live, checkpointId);
      if (result === live) throw new Error('liveCheckpointNotRestorable');
      return result;
    });
  }

  async finalizeLiveTournament(id: string, expectedVersion: number, _idempotencyKey?: string): Promise<LiveFinalizeResult> {
    const live = await this.getLiveTournament(id);
    if (!live) throw new Error('liveTournamentNotFound');
    if (live.documentVersion !== expectedVersion) throw new Error('staleLiveTournamentDocument');
    const targetLeagueId = live.leagueId || PLACEHOLDER_LEAGUE_ID;
    const stableLive = live.finalizedTournamentId
      ? { ...live, leagueId: targetLeagueId }
      : await this.saveLiveTournament({ ...live, leagueId: targetLeagueId, finalizedTournamentId: crypto.randomUUID() });
    const league = await this.getLeague(targetLeagueId);
    if (!league) throw new Error('leagueNotFound');
    const tournament = { ...buildFinalizedTournament(stableLive), leagueId: league.id };
    const nextLeague = {
      ...league,
      tournaments: league.tournaments.some((item) => item.id === tournament.id)
        ? league.tournaments.map((item) => item.id === tournament.id ? tournament : item)
        : [...league.tournaments, tournament]
    };
    const savedLeague = await this.saveLeague(nextLeague, league.documentVersion);
    const savedTournament = savedLeague.tournaments.find((item) => item.id === tournament.id) ?? tournament;
    const completed = await this.saveLiveTournament({ ...stableLive, stage: 'completed', finalizedTournamentId: savedTournament.id });
    await this.deleteLiveTournament(stableLive.id, completed.documentVersion);
    return {
      liveTournamentId: id,
      leagueId: savedLeague.id,
      finalizedTournamentId: savedTournament.id,
      liveDocumentVersion: completed.documentVersion
    };
  }

  async saveLiveTournament(tournament: LiveTournamentDocument): Promise<LiveTournamentDocument> {
    return this.withLiveStoreLock(() => {
      const incoming = normalizeLiveTournament(tournament);
      let saved: LiveTournamentDocument | null = null;
      this.mutateLiveStore((store) => {
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

  private async mutateLiveTournament(id: string, expectedVersion: number, transform: (live: LiveTournamentDocument) => LiveTournamentDocument): Promise<LiveTournamentDocument> {
    const live = await this.getLiveTournament(id);
    if (!live) throw new Error('liveTournamentNotFound');
    if (live.documentVersion !== expectedVersion) throw new Error('staleLiveTournamentDocument');
    return this.saveLiveTournament(transform(live));
  }

  private withAutomaticLiveRoundCount(live: LiveTournamentDocument): LiveTournamentDocument {
    if (live.customRoundCount || live.stage !== 'registration') return live;
    return { ...live, roundCount: autoLiveSwissRoundCount(live) };
  }

  private livePlayerNameExists(live: LiveTournamentDocument, name: string): boolean {
    return live.players.some((player) => trimPlayerName(player.name).toLowerCase() === name.toLowerCase());
  }

  private livePlayerHasRoundEntry(live: LiveTournamentDocument, playerName: string): boolean {
    const normalizedName = trimPlayerName(playerName);
    return live.rounds.some((round) => round.entries.some(({ entry }) => {
      if (entry.kind === 'bye') return trimPlayerName(entry.playerName) === normalizedName;
      if (entry.kind === 'match') return trimPlayerName(entry.player1Name) === normalizedName || trimPlayerName(entry.player2Name) === normalizedName;
      return false;
    }));
  }

  private renameLiveRoundEntries(rounds: LiveTournamentDocument['rounds'], oldName: string, newName: string): LiveTournamentDocument['rounds'] {
    const normalizedOldName = trimPlayerName(oldName);
    if (!normalizedOldName) return rounds;
    return rounds.map((round) => ({
      ...round,
      entries: round.entries.map((item) => {
        const entry = item.entry;
        if (entry.kind === 'bye' && trimPlayerName(entry.playerName) === normalizedOldName) return { ...item, entry: { ...entry, playerName: newName } };
        if (entry.kind === 'match') {
          return {
            ...item,
            entry: {
              ...entry,
              player1Name: trimPlayerName(entry.player1Name) === normalizedOldName ? newName : entry.player1Name,
              player2Name: trimPlayerName(entry.player2Name) === normalizedOldName ? newName : entry.player2Name
            }
          };
        }
        return item;
      })
    }));
  }

  private async withLiveStoreLock<T>(callback: () => T): Promise<T> {
    const locks = navigator.locks;
    return locks ? locks.request(LIVE_STORE_KEY, callback) : callback();
  }

  private readLiveStore(): LiveTournamentStore {
    const raw = localStorage.getItem(LIVE_STORE_KEY);
    try {
      const parsed = JSON.parse(raw ?? 'null') as Partial<LiveTournamentStore> | null;
      return this.normalizeLiveStore(parsed, raw);
    } catch (error) {
      logBoundaryError('local-frontend-backend.live.read', error, { hasRaw: Boolean(raw) });
      this.backupRawLiveStore(raw);
      return this.defaultLiveStore();
    }
  }

  private mutateLiveStore(update: (store: LiveTournamentStore) => LiveTournamentStore): void {
    localStorage.setItem(LIVE_STORE_KEY, JSON.stringify(update(this.readLiveStore())));
  }

  private normalizeLiveStore(store: Partial<LiveTournamentStore> | null, raw: string | null): LiveTournamentStore {
    if (!store) return this.defaultLiveStore();
    if (!Array.isArray(store.tournaments)) {
      this.backupRawLiveStore(raw);
      return this.defaultLiveStore();
    }
    return {
      version: 1,
      tournaments: store.tournaments.map((tournament) => normalizeLiveTournament(tournament)),
      deletedTournamentIds: Array.isArray(store.deletedTournamentIds) ? store.deletedTournamentIds.filter((id) => typeof id === 'string') : []
    };
  }

  private backupRawLiveStore(raw: string | null): void {
    if (!raw) return;
    localStorage.setItem(`${LIVE_CORRUPT_BACKUP_PREFIX}.${new Date().toISOString()}`, raw);
  }

  private defaultLiveStore(): LiveTournamentStore {
    return { version: 1, tournaments: [], deletedTournamentIds: [] };
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
