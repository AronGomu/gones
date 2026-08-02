import { inject, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { LEAGUE_BACKEND, LeagueBackendPort, FullLeagueRestoreCommand, LeagueRestoreCommand } from '../backend/application-backend';
import { createPlaceholderLeague, getDefaultTournamentName, isUnassignedLeagueName, LeagueDocument, LeagueStatus, PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, TournamentDocument } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class LeagueRepository {
  private readonly backend: LeagueBackendPort = inject(LEAGUE_BACKEND);
  readonly serverMode = environment.features.leagueServer;

  get configured(): boolean { return !this.serverMode || environment.apiBaseUrl.length > 0; }

  async listLeagues(): Promise<PersistedLeague[]> {
    if (!this.serverMode) await this.ensurePlaceholderLeague();
    return this.backend.listLeagues();
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    if (!this.serverMode && id === PLACEHOLDER_LEAGUE_ID) await this.ensurePlaceholderLeague();
    return this.backend.getLeague(id);
  }

  async createLeague(name: string, idempotencyKey?: string): Promise<PersistedLeague> {
    if (isUnassignedLeagueName(name)) return this.ensurePlaceholderLeague();
    return this.backend.createLeague(name, idempotencyKey);
  }

  async renameLeague(league: PersistedLeague, name: string): Promise<PersistedLeague> {
    return this.backend.renameLeague(league.id, league.documentVersion, name);
  }

  async changeLeagueStatus(league: PersistedLeague, status: LeagueStatus): Promise<PersistedLeague> {
    return this.backend.changeLeagueStatus(league.id, league.documentVersion, status);
  }

  async insertLeague(league: LeagueDocument): Promise<PersistedLeague> {
    if (this.serverMode) throw new Error('leagueWholeDocumentSaveDisabled');
    if (league.id === PLACEHOLDER_LEAGUE_ID || isUnassignedLeagueName(league.name)) {
      const existing = await this.ensurePlaceholderLeague();
      if (!league.tournaments?.length) return existing;
      const mergedTournaments = [
        ...existing.tournaments.filter((item) => !league.tournaments.some((incoming) => incoming.id === item.id)),
        ...league.tournaments.map((tournament) => ({ ...tournament, leagueId: PLACEHOLDER_LEAGUE_ID }))
      ];
      return this.backend.saveLeague({ ...existing, tournaments: mergedTournaments }, existing.documentVersion);
    }
    return this.backend.insertLeague(league);
  }

  async saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague> {
    if (this.serverMode) throw new Error('leagueWholeDocumentSaveDisabled');
    return this.backend.saveLeague(league, expectedVersion);
  }

  async deleteLeague(id: string): Promise<void> {
    if (id === PLACEHOLDER_LEAGUE_ID) throw new Error('placeholderLeagueCannotBeDeleted');
    const league = await this.backend.getLeague(id);
    if (!league) throw new Error('leagueNotFound');
    await this.backend.deleteLeague(id, league.documentVersion);
    if (!this.serverMode) await this.ensurePlaceholderLeague();
  }

  async ensurePlaceholderLeague(): Promise<PersistedLeague> {
    const existing = await this.backend.getLeague(PLACEHOLDER_LEAGUE_ID);
    if (existing) return existing;
    if (this.serverMode) throw new Error('placeholderLeagueMissing');
    return this.backend.insertLeague(createPlaceholderLeague());
  }

  async createResultTournament(league: PersistedLeague, name = getDefaultTournamentName(), tournamentDate = ''): Promise<{ league: PersistedLeague; tournament: TournamentDocument }> {
    const updated = await this.backend.createResultTournament(league.id, league.documentVersion, name, tournamentDate);
    const previousIds = new Set(league.tournaments.map(tournament => tournament.id));
    const tournament = updated.tournaments.find(item => !previousIds.has(item.id));
    if (!tournament) throw new Error('createdTournamentMissing');
    return { league: updated, tournament };
  }

  editResultTournament(league: PersistedLeague, tournamentId: string, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.backend.editResultTournament(league.id, tournamentId, league.documentVersion, name, tournamentDate);
  }

  deleteResultTournament(league: PersistedLeague, tournamentId: string): Promise<PersistedLeague> {
    return this.backend.deleteResultTournament(league.id, tournamentId, league.documentVersion);
  }

  addResultRound(league: PersistedLeague, tournamentId: string): Promise<PersistedLeague> {
    return this.backend.addResultRound(league.id, tournamentId, league.documentVersion);
  }

  deleteResultRound(league: PersistedLeague, tournamentId: string, roundId: string): Promise<PersistedLeague> {
    return this.backend.deleteResultRound(league.id, tournamentId, roundId, league.documentVersion);
  }

  importResultRound(league: PersistedLeague, tournamentId: string, roundId: string, text: string): Promise<PersistedLeague> {
    return this.backend.importResultRound(league.id, tournamentId, roundId, league.documentVersion, text);
  }

  replaceResultRound(league: PersistedLeague, tournamentId: string, roundId: string, entries: RoundEntry[]): Promise<PersistedLeague> {
    return this.backend.replaceResultRound(league.id, tournamentId, roundId, league.documentVersion, entries);
  }

  addResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entry: RoundEntry): Promise<PersistedLeague> {
    return this.backend.addResultEntry(league.id, tournamentId, roundId, league.documentVersion, entry);
  }

  editResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entryId: string, entry: RoundEntry): Promise<PersistedLeague> {
    return this.backend.editResultEntry(league.id, tournamentId, roundId, entryId, league.documentVersion, entry);
  }

  deleteResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entryId: string): Promise<PersistedLeague> {
    return this.backend.deleteResultEntry(league.id, tournamentId, roundId, entryId, league.documentVersion);
  }

  updateResultPlayerArchetype(league: PersistedLeague, tournamentId: string, playerName: string, archetype: string): Promise<PersistedLeague> {
    return this.backend.updateResultPlayerArchetype(league.id, tournamentId, playerName, league.documentVersion, archetype);
  }

  renameLeaguePlayerName(league: PersistedLeague, fromName: string, toName: string): Promise<PersistedLeague> {
    return this.backend.renameLeaguePlayerName(league.id, league.documentVersion, fromName, toName);
  }

  restoreLeague(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague> {
    return this.backend.restoreLeague(command, idempotencyKey);
  }

  restoreFullLeagueData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]> {
    return this.backend.restoreFullLeagueData(command, idempotencyKey);
  }

  async moveTournament(tournamentId: string, fromLeagueId: string, toLeagueId: string): Promise<{ fromLeague: PersistedLeague; toLeague: PersistedLeague }> {
    const targetLeagueId = toLeagueId || PLACEHOLDER_LEAGUE_ID;
    if (!this.serverMode) await this.ensurePlaceholderLeague();
    const fromLeague = await this.backend.getLeague(fromLeagueId);
    const toLeague = await this.backend.getLeague(targetLeagueId);
    if (!fromLeague || !toLeague) throw new Error('leagueNotFound');
    return this.backend.moveResultTournament(fromLeagueId, tournamentId, fromLeague.documentVersion, targetLeagueId, toLeague.documentVersion);
  }
}
