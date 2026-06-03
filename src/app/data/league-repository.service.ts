import { inject, Injectable } from '@angular/core';
import { APP_BACKEND, ApplicationBackend } from '../backend/application-backend';
import { LeagueDocument, PersistedLeague } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class LeagueRepository {
  private readonly backend: ApplicationBackend = inject(APP_BACKEND);

  get configured(): boolean { return this.backend.configured; }

  async listLeagues(): Promise<PersistedLeague[]> {
    return this.backend.listLeagues();
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
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
    await this.backend.deleteLeague(id);
  }
}
