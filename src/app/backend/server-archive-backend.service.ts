import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_ETAG, ApiProblemError, joinApiUrl } from '../api/api-boundary';
import { API_BASE_URL } from '../api/generated/gones-api';
import type { PersistedArchiveTournament } from '../domain/archive-models';
import type { PlayerArchetypeDocument, RoundDocument, RoundEntry } from '../domain/models';
import type { ArchiveTournamentEditBatch } from './local-archive-backend.service';

/**
 * The two Tournament operations the staged editor needs, and nothing else.
 *
 * `LocalArchiveBackend` satisfies this shape structurally, which is the whole point: the repository
 * picks an implementation from the record's origin and calls the same two members either way
 * (ADR 0028). It is deliberately NOT the full `ArchiveBackendPort` — this ticket ships one write
 * flow, and a port with fifteen unimplemented members would be a lie about what works.
 */
export interface ArchiveTournamentPort {
  /** `null` for `404` — an absent or soft-deleted Tournament is a page state, not an error. */
  getArchiveTournament(tournamentId: string): Promise<PersistedArchiveTournament | null>;
  applyArchiveTournamentEditBatch(
    tournamentId: string,
    expectedVersion: number,
    batch: ArchiveTournamentEditBatch
  ): Promise<PersistedArchiveTournament>;
}

/**
 * The strong ETag the API mints, reproduced: `"` + base64(int64 big-endian) + `"`, matching
 * `backend/src/Gones.Application/Concurrency/StrongETag.cs:7-13`.
 *
 * This is a copy of `encodeLeagueETag` rather than an import, because that function lives in
 * `aspnet-api-backend.service.ts`, whose archive half is deleted when the legacy surface is retired.
 * A reference into a doomed file would break at deletion time; twelve duplicated lines will not.
 */
export function encodeArchiveETag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalidArchiveDocumentVersion');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(version));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `"${btoa(binary)}"`;
}

/** The runtime JSON of `GET /api/archive/tournaments/{id}`. */
interface RawArchiveTournamentDetail {
  id: string;
  name: string;
  seasonId?: string | null;
  tournamentDate: string;
  status: string;
  rounds?: RoundDocument[];
  playerArchetypes?: PlayerArchetypeDocument[];
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

/** The runtime JSON of `POST /api/archive/tournaments/{id}/edit-batch`. */
interface RawArchiveTournamentEditBatchResponse {
  tournament: RawArchiveTournamentDetail;
}

/** The wire body. `moveToSeason` present ⇒ move; its `seasonId: null` ⇒ detach to standalone. */
interface RawArchiveTournamentEditBatchRequest {
  moveToSeason: { seasonId: string | null } | null;
  editTournament: { name: string; tournamentDate: string } | null;
  status: string | null;
  addRounds: { roundId: string; entries: RoundEntry[] }[];
  deleteRoundIds: string[];
  replaceRounds: { roundId: string; entries: RoundEntry[] }[];
  updateArchetypes: { playerName: string; archetype: string }[];
}

@Injectable({ providedIn: 'root' })
export class ServerArchiveBackend implements ArchiveTournamentPort {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  async getArchiveTournament(tournamentId: string): Promise<PersistedArchiveTournament | null> {
    try {
      const raw = await firstValueFrom(this.http.get<RawArchiveTournamentDetail>(
        joinApiUrl(this.baseUrl, `/api/archive/tournaments/${encodeURIComponent(tournamentId)}`)
      ));
      return toPersistedArchiveTournament(raw);
    } catch (error) {
      // A missing Tournament is a page state, not a failure. Everything else propagates so the
      // caller can tell "not there" from "could not ask".
      if (error instanceof ApiProblemError && error.status === 404) return null;
      throw error;
    }
  }

  async applyArchiveTournamentEditBatch(
    tournamentId: string,
    expectedVersion: number,
    batch: ArchiveTournamentEditBatch
  ): Promise<PersistedArchiveTournament> {
    const body: RawArchiveTournamentEditBatchRequest = {
      moveToSeason: Object.hasOwn(batch, 'moveToSeasonId') ? { seasonId: batch.moveToSeasonId ?? null } : null,
      editTournament: batch.editTournament ?? null,
      status: batch.status ?? null,
      addRounds: batch.addRounds.map((round) => ({ roundId: round.roundId, entries: round.entries })),
      deleteRoundIds: [...batch.deleteRoundIds],
      replaceRounds: batch.replaceRounds.map((round) => ({ roundId: round.roundId, entries: round.entries })),
      updateArchetypes: batch.updateArchetypes.map((row) => ({ playerName: row.playerName, archetype: row.archetype }))
    };
    const response = await firstValueFrom(this.http.post<RawArchiveTournamentEditBatchResponse>(
      joinApiUrl(this.baseUrl, `/api/archive/tournaments/${encodeURIComponent(tournamentId)}/edit-batch`),
      body,
      { context: new HttpContext().set(API_ETAG, encodeArchiveETag(expectedVersion)) }
    ));
    return toPersistedArchiveTournament(response.tournament);
  }
}

/** The wire is trusted for shape, not for completeness: `seasonId` may arrive `null`, and both
 *  collections are absent on a Tournament that has neither. Everything else is required. */
function toPersistedArchiveTournament(raw: RawArchiveTournamentDetail): PersistedArchiveTournament {
  return {
    id: raw.id,
    name: raw.name,
    seasonId: raw.seasonId ?? null,
    tournamentDate: raw.tournamentDate,
    status: raw.status === 'completed' ? 'completed' : 'active',
    rounds: raw.rounds ?? [],
    playerArchetypes: raw.playerArchetypes ?? [],
    documentVersion: raw.documentVersion,
    updatedAt: raw.updatedAt,
    ...(raw.eTag ? { eTag: raw.eTag } : {})
  };
}
