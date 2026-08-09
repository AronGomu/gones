import { inject, Injectable } from '@angular/core';
import { LEAGUE_ARCHIVE_BACKEND, LeagueArchiveBackendPort, FullLeagueRestoreCommand, LeagueRestoreCommand } from '../backend/application-backend';
import { getDefaultTournamentName, isUnassignedLeagueName, LeagueStatus, PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, TournamentDocument } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class LeagueArchiveRepository {
  private readonly backend: LeagueArchiveBackendPort = inject(LEAGUE_ARCHIVE_BACKEND);

  async listLeagues(): Promise<PersistedLeague[]> {
    return this.backend.listLeagueArchives();
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    return this.backend.getLeagueArchive(id);
  }

  async createLeague(name: string, idempotencyKey?: string): Promise<PersistedLeague> {
    if (isUnassignedLeagueName(name)) return this.ensurePlaceholderLeague();
    return this.backend.createLeagueArchive(name, idempotencyKey);
  }

  async renameLeague(league: PersistedLeague, name: string): Promise<PersistedLeague> {
    return this.backend.renameLeagueArchive(league.id, league.documentVersion, name);
  }

  async changeLeagueStatus(league: PersistedLeague, status: LeagueStatus): Promise<PersistedLeague> {
    return this.backend.changeLeagueArchiveStatus(league.id, league.documentVersion, status);
  }

  async deleteLeague(id: string): Promise<void> {
    if (id === PLACEHOLDER_LEAGUE_ID) throw new Error('placeholderLeagueCannotBeDeleted');
    const league = await this.backend.getLeagueArchive(id);
    if (!league) throw new Error('leagueNotFound');
    await this.backend.deleteLeagueArchive(id, league.documentVersion);
  }

  /** The server seeds the placeholder League; the browser has no way to create one. */
  async ensurePlaceholderLeague(): Promise<PersistedLeague> {
    const existing = await this.backend.getLeagueArchive(PLACEHOLDER_LEAGUE_ID);
    if (!existing) throw new Error('placeholderLeagueMissing');
    return existing;
  }

  async createResultTournament(league: PersistedLeague, name = getDefaultTournamentName(), tournamentDate = ''): Promise<{ league: PersistedLeague; tournament: TournamentDocument }> {
    const updated = await this.backend.createArchiveTournament(league.id, league.documentVersion, name, tournamentDate);
    const previousIds = new Set(league.tournaments.map(tournament => tournament.id));
    const tournament = updated.tournaments.find(item => !previousIds.has(item.id));
    if (!tournament) throw new Error('createdTournamentMissing');
    return { league: updated, tournament };
  }

  editResultTournament(league: PersistedLeague, tournamentId: string, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.backend.editArchiveTournament(league.id, tournamentId, league.documentVersion, name, tournamentDate);
  }

  deleteResultTournament(league: PersistedLeague, tournamentId: string): Promise<PersistedLeague> {
    return this.backend.deleteArchiveTournament(league.id, tournamentId, league.documentVersion);
  }

  addResultRound(league: PersistedLeague, tournamentId: string): Promise<PersistedLeague> {
    return this.backend.addArchiveRound(league.id, tournamentId, league.documentVersion);
  }

  deleteResultRound(league: PersistedLeague, tournamentId: string, roundId: string): Promise<PersistedLeague> {
    return this.backend.deleteArchiveRound(league.id, tournamentId, roundId, league.documentVersion);
  }

  importResultRound(league: PersistedLeague, tournamentId: string, roundId: string, text: string): Promise<PersistedLeague> {
    return this.backend.importArchiveRound(league.id, tournamentId, roundId, league.documentVersion, text);
  }

  replaceResultRound(league: PersistedLeague, tournamentId: string, roundId: string, entries: RoundEntry[]): Promise<PersistedLeague> {
    return this.backend.replaceArchiveRound(league.id, tournamentId, roundId, league.documentVersion, entries);
  }

  addResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entry: RoundEntry): Promise<PersistedLeague> {
    return this.backend.addArchiveEntry(league.id, tournamentId, roundId, league.documentVersion, entry);
  }

  editResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entryId: string, entry: RoundEntry): Promise<PersistedLeague> {
    return this.backend.editArchiveEntry(league.id, tournamentId, roundId, entryId, league.documentVersion, entry);
  }

  deleteResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entryId: string): Promise<PersistedLeague> {
    return this.backend.deleteArchiveEntry(league.id, tournamentId, roundId, entryId, league.documentVersion);
  }

  updateResultPlayerArchetype(league: PersistedLeague, tournamentId: string, playerName: string, archetype: string): Promise<PersistedLeague> {
    return this.backend.updateArchivePlayerArchetype(league.id, tournamentId, playerName, league.documentVersion, archetype);
  }

  renameLeaguePlayerName(league: PersistedLeague, fromName: string, toName: string): Promise<PersistedLeague> {
    return this.backend.renameLeagueArchivePlayerName(league.id, league.documentVersion, fromName, toName);
  }

  restoreLeague(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague> {
    return this.backend.restoreLeagueArchive(command, idempotencyKey);
  }

  restoreFullLeagueData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]> {
    return this.backend.restoreFullLeagueArchiveData(command, idempotencyKey);
  }

  async moveTournament(tournamentId: string, fromLeagueId: string, toLeagueId: string): Promise<{ fromLeague: PersistedLeague; toLeague: PersistedLeague }> {
    const targetLeagueId = toLeagueId || PLACEHOLDER_LEAGUE_ID;
    const fromLeague = await this.backend.getLeagueArchive(fromLeagueId);
    const toLeague = await this.backend.getLeagueArchive(targetLeagueId);
    if (!fromLeague || !toLeague) throw new Error('leagueNotFound');
    return this.backend.moveArchiveTournament(fromLeagueId, tournamentId, fromLeague.documentVersion, targetLeagueId, toLeague.documentVersion);
  }
}
