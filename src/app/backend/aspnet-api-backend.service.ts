import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiProblemError } from '../api/api-boundary';
import { Client, LeagueCommandResponse, PublicLeagueDetailResponse } from '../api/generated/gones-api';
import { CalendarEventDocument, LeagueDocument, LeagueStatus, PersistedLeague, RoundEntry } from '../domain/models';
import type { ApplicationBackend, FullLeagueRestoreCommand, LeagueRestoreCommand, MoveResultTournamentResult } from './application-backend';

@Injectable({ providedIn: 'root' })
export class AspNetApiBackend implements ApplicationBackend {
  readonly mode = 'aspnet-api' as const;
  readonly configured = Boolean(environment.apiBaseUrl);

  constructor(private readonly client: Client, private readonly http: HttpClient) {}

  async listLeagues(): Promise<PersistedLeague[]> {
    const summaries = [];
    const pageSize = 100;
    for (let page = 1; ; page++) {
      const response = await firstValueFrom(this.client.leagues(page, pageSize, undefined, undefined));
      summaries.push(...response.items);
      if (summaries.length >= response.totalCount) break;
    }
    return Promise.all(summaries.map(async item => this.toPersisted(await firstValueFrom(this.client.leagues2(item.id)))));
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    try { return this.toPersisted(await firstValueFrom(this.client.leagues2(id))); }
    catch (error) {
      if (error instanceof ApiProblemError && error.status === 404) return null;
      throw error;
    }
  }

  async createLeague(name: string, idempotencyKey = newIdempotencyKey()): Promise<PersistedLeague> {
    return this.command(this.client.createLeague(idempotencyKey, { name }));
  }

  renameLeague(id: string, expectedVersion: number, name: string): Promise<PersistedLeague> {
    return this.command(this.client.renameLeague(id, encodeLeagueETag(expectedVersion), { name }));
  }

  changeLeagueStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague> {
    return this.command(this.client.changeLeagueStatus(id, encodeLeagueETag(expectedVersion), { status }));
  }

  async deleteLeague(id: string, expectedVersion: number): Promise<void> {
    await firstValueFrom(this.client.deleteLeague(id, encodeLeagueETag(expectedVersion)));
  }

  createResultTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.command(this.client.createResultTournament(id, encodeLeagueETag(expectedVersion), { name, tournamentDate }));
  }

  editResultTournament(id: string, tournamentId: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.command(this.client.editResultTournament(id, tournamentId, encodeLeagueETag(expectedVersion), { name, tournamentDate }));
  }

  deleteResultTournament(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.command(this.client.deleteResultTournament(id, tournamentId, encodeLeagueETag(expectedVersion)));
  }

  async moveResultTournament(id: string, tournamentId: string, expectedVersion: number, targetLeagueId: string, targetExpectedVersion: number): Promise<MoveResultTournamentResult> {
    const response = await firstValueFrom(this.client.moveResultTournament(id, tournamentId, encodeLeagueETag(expectedVersion), encodeLeagueETag(targetExpectedVersion), { targetLeagueId }));
    return { fromLeague: this.toPersisted(response.source), toLeague: this.toPersisted(response.target) };
  }

  addResultRound(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.command(this.client.addResultRound(id, tournamentId, encodeLeagueETag(expectedVersion)));
  }

  deleteResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.command(this.client.deleteResultRound(id, tournamentId, roundId, encodeLeagueETag(expectedVersion)));
  }

  importResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedLeague> {
    return this.command(this.client.importResultRound(id, tournamentId, roundId, encodeLeagueETag(expectedVersion), { text }));
  }

  replaceResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedLeague> {
    return this.command(this.client.replaceResultRound(id, tournamentId, roundId, encodeLeagueETag(expectedVersion), { entries: entries as never }));
  }

  addResultEntry(id: string, tournamentId: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague> {
    return this.command(this.client.addResultEntry(id, tournamentId, roundId, encodeLeagueETag(expectedVersion), entry as never));
  }

  editResultEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague> {
    return this.command(this.client.editResultEntry(id, tournamentId, roundId, entryId, encodeLeagueETag(expectedVersion), entry as never));
  }

  deleteResultEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.command(this.client.deleteResultEntry(id, tournamentId, roundId, entryId, encodeLeagueETag(expectedVersion)));
  }

  updateResultPlayerArchetype(id: string, tournamentId: string, playerName: string, expectedVersion: number, archetype: string): Promise<PersistedLeague> {
    return this.command(this.client.updateResultPlayerArchetype(id, tournamentId, playerName, encodeLeagueETag(expectedVersion), { archetype }));
  }

  renameLeaguePlayerName(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedLeague> {
    return this.command(this.client.renameLeaguePlayerName(id, encodeLeagueETag(expectedVersion), { fromName, toName }));
  }

  restoreLeague(command: LeagueRestoreCommand, idempotencyKey = newIdempotencyKey()): Promise<PersistedLeague> {
    return this.command(this.client.restoreLeague(idempotencyKey, command as never));
  }

  async restoreFullLeagueData(command: FullLeagueRestoreCommand, idempotencyKey = newIdempotencyKey()): Promise<PersistedLeague[]> {
    const response = await firstValueFrom(this.client.restoreFullLeagueData(idempotencyKey, command as never));
    return response.leagues.map(league => this.toPersisted(league));
  }

  insertLeague(_league: LeagueDocument): Promise<PersistedLeague> {
    return Promise.reject(new Error('leagueWholeDocumentSaveDisabled'));
  }

  saveLeague(_league: LeagueDocument, _expectedVersion: number): Promise<PersistedLeague> {
    return Promise.reject(new Error('leagueWholeDocumentSaveDisabled'));
  }

  listCalendarEvents(): Promise<CalendarEventDocument[]> {
    return firstValueFrom(this.http.get<CalendarEventDocument[]>(this.url('/calendar-events')));
  }

  saveCalendarEvent(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    return firstValueFrom(this.http.put<CalendarEventDocument>(this.url(`/calendar-events/${encodeURIComponent(event.id)}`), { event }));
  }

  deleteCalendarEvent(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(`/calendar-events/${encodeURIComponent(id)}`)));
  }

  private async command(request: ReturnType<Client['createLeague']>): Promise<PersistedLeague> {
    return this.toPersisted(await firstValueFrom(request));
  }

  private toPersisted(response: LeagueCommandResponse | PublicLeagueDetailResponse): PersistedLeague {
    return {
      id: response.id,
      name: response.name,
      status: response.status as LeagueStatus,
      tournaments: response.tournaments as unknown as PersistedLeague['tournaments'],
      documentVersion: response.documentVersion,
      updatedAt: String(response.updatedAt),
      eTag: 'eTag' in response ? response.eTag : encodeLeagueETag(response.documentVersion)
    };
  }

  private url(path: string): string {
    return `${environment.apiBaseUrl.replace(/\/$/, '')}${path}`;
  }
}

export function encodeLeagueETag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalidLeagueDocumentVersion');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(version));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `"${btoa(binary)}"`;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `league-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
