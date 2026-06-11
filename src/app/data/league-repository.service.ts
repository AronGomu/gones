import { inject, Injectable } from '@angular/core';
import { APP_BACKEND, ApplicationBackend } from '../backend/application-backend';
import { createPlaceholderLeague, LeagueDocument, PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class LeagueRepository {
  private readonly backend: ApplicationBackend = inject(APP_BACKEND);

  get configured(): boolean { return this.backend.configured; }

  async listLeagues(): Promise<PersistedLeague[]> {
    await this.ensurePlaceholderLeague();
    return this.backend.listLeagues();
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    if (id === PLACEHOLDER_LEAGUE_ID) await this.ensurePlaceholderLeague();
    return this.backend.getLeague(id);
  }

  async createLeague(name: string): Promise<PersistedLeague> {
    return this.backend.createLeague(name);
  }

  async insertLeague(league: LeagueDocument): Promise<PersistedLeague> {
    return this.backend.insertLeague(league);
  }

  async saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague> {
    return this.backend.saveLeague(league, expectedVersion);
  }

  async deleteLeague(id: string): Promise<void> {
    if (id === PLACEHOLDER_LEAGUE_ID) throw new Error('placeholderLeagueCannotBeDeleted');
    await this.backend.deleteLeague(id);
    await this.ensurePlaceholderLeague();
  }

  async ensurePlaceholderLeague(): Promise<PersistedLeague> {
    const existing = await this.backend.getLeague(PLACEHOLDER_LEAGUE_ID);
    if (existing) return existing;
    return this.backend.insertLeague(createPlaceholderLeague());
  }

  async moveTournament(tournamentId: string, fromLeagueId: string, toLeagueId: string): Promise<{ fromLeague: PersistedLeague; toLeague: PersistedLeague }> {
    const targetLeagueId = toLeagueId || PLACEHOLDER_LEAGUE_ID;
    await this.ensurePlaceholderLeague();
    if (fromLeagueId === targetLeagueId) {
      const league = await this.backend.getLeague(fromLeagueId);
      if (!league) throw new Error('leagueNotFound');
      return { fromLeague: league, toLeague: league };
    }
    const fromLeague = await this.backend.getLeague(fromLeagueId);
    const toLeague = await this.backend.getLeague(targetLeagueId);
    if (!fromLeague || !toLeague) throw new Error('leagueNotFound');
    const tournament = fromLeague.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) throw new Error('tournamentNotFound');
    const movedTournament = { ...tournament, leagueId: targetLeagueId };
    const savedFrom = await this.backend.saveLeague({ ...fromLeague, tournaments: fromLeague.tournaments.filter((item) => item.id !== tournamentId) }, fromLeague.documentVersion);
    try {
      const savedTo = await this.backend.saveLeague({ ...toLeague, tournaments: [...toLeague.tournaments.filter((item) => item.id !== tournamentId), movedTournament] }, toLeague.documentVersion);
      return { fromLeague: savedFrom, toLeague: savedTo };
    } catch (error) {
      await this.backend.saveLeague({ ...savedFrom, tournaments: [...savedFrom.tournaments, tournament] }, savedFrom.documentVersion);
      throw error;
    }
  }
}
