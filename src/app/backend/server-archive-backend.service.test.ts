import '@angular/compiler';
import { HttpContext } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { API_ETAG, ApiProblemError } from '../api/api-boundary';
import type { ArchiveTournamentEditBatch } from './local-archive-backend.service';
import { ServerArchiveBackend, encodeArchiveETag } from './server-archive-backend.service';

interface RecordedRequest {
  method: 'get' | 'post';
  url: string;
  body?: unknown;
  context?: HttpContext;
}

function fake(response: unknown, thrown?: unknown) {
  const calls: RecordedRequest[] = [];
  const http = {
    get: (url: string) => {
      calls.push({ method: 'get', url });
      return thrown ? throwError(() => thrown) : of(response);
    },
    post: (url: string, body: unknown, options: { context?: HttpContext } = {}) => {
      calls.push({ method: 'post', url, body, context: options.context });
      return thrown ? throwError(() => thrown) : of(response);
    }
  };
  const service = Object.create(ServerArchiveBackend.prototype) as ServerArchiveBackend;
  Object.assign(service, { http, baseUrl: 'https://api.test' });
  return { service, calls };
}

function batch(overrides: Partial<ArchiveTournamentEditBatch> = {}): ArchiveTournamentEditBatch {
  return { addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [], ...overrides };
}

function commandResponse(overrides: Record<string, unknown> = {}) {
  return {
    tournament: {
      id: 't1',
      name: 'Spring Open',
      seasonId: 's1',
      tournamentDate: '2026-08-17',
      status: 'completed',
      rounds: [],
      playerArchetypes: [],
      documentVersion: 5,
      updatedAt: '2026-08-17T10:00:00Z',
      eTag: '"AAAAAAAAAAU="',
      ...overrides
    }
  };
}

describe('encodeArchiveETag', () => {
  it('encodes the strong ETag the API mints', () => {
    expect(encodeArchiveETag(5)).toBe('"AAAAAAAAAAU="');
  });

  it('refuses a version that cannot be an ETag', () => {
    expect(() => encodeArchiveETag(0)).toThrow('invalidArchiveDocumentVersion');
    expect(() => encodeArchiveETag(1.5)).toThrow('invalidArchiveDocumentVersion');
  });
});

describe('ServerArchiveBackend.applyArchiveTournamentEditBatch', () => {
  it('posts the batch to the tournament edit-batch route', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('t1', 4, batch());
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('post');
    expect(calls[0].url).toBe('https://api.test/api/archive/tournaments/t1/edit-batch');
  });

  it('carries the expected version as the If-Match context', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('t1', 4, batch());
    expect(calls[0].context?.get(API_ETAG)).toBe(encodeArchiveETag(4));
    // The header itself is never set by hand: `apiBoundaryInterceptor` derives it from the context.
    expect(JSON.stringify(calls[0].body)).not.toContain('If-Match');
  });

  it('omits the move when the batch does not move', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('t1', 4, batch());
    expect((calls[0].body as { moveToSeason: unknown }).moveToSeason).toBeNull();
  });

  it('sends a null seasonId when detaching to standalone', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('t1', 4, batch({ moveToSeasonId: null }));
    expect((calls[0].body as { moveToSeason: unknown }).moveToSeason).toEqual({ seasonId: null });
  });

  it('sends the target seasonId when attaching', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('t1', 4, batch({ moveToSeasonId: 's2' }));
    expect((calls[0].body as { moveToSeason: unknown }).moveToSeason).toEqual({ seasonId: 's2' });
  });

  it('sends null for absent editTournament and status', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('t1', 4, batch());
    const body = calls[0].body as { editTournament: unknown; status: unknown };
    expect(body.editTournament).toBeNull();
    expect(body.status).toBeNull();
  });

  it('adopts the document from the response envelope', async () => {
    const { service } = fake(commandResponse({ seasonId: null }));
    const saved = await service.applyArchiveTournamentEditBatch('t1', 4, batch());
    expect(saved.id).toBe('t1');
    expect(saved.documentVersion).toBe(5);
    expect(saved.seasonId).toBeNull();
    expect(saved.status).toBe('completed');
  });

  it('defaults absent collections to empty arrays', async () => {
    const { service } = fake(commandResponse({ rounds: undefined, playerArchetypes: undefined }));
    const saved = await service.applyArchiveTournamentEditBatch('t1', 4, batch());
    expect(saved.rounds).toEqual([]);
    expect(saved.playerArchetypes).toEqual([]);
  });

  it('escapes the tournament id in the path', async () => {
    const { service, calls } = fake(commandResponse());
    await service.applyArchiveTournamentEditBatch('a/b', 4, batch());
    expect(calls[0].url).toContain('/api/archive/tournaments/a%2Fb/edit-batch');
  });
});

describe('ServerArchiveBackend.getArchiveTournament', () => {
  it('reads a tournament from the detail route', async () => {
    const { service, calls } = fake(commandResponse().tournament);
    const detail = await service.getArchiveTournament('t1');
    expect(calls[0].method).toBe('get');
    expect(calls[0].url).toBe('https://api.test/api/archive/tournaments/t1');
    expect(detail?.documentVersion).toBe(5);
  });

  it('returns null for a 404 and rethrows everything else', async () => {
    const missing = fake(null, new ApiProblemError(404, { code: 'not_found' }));
    await expect(missing.service.getArchiveTournament('t1')).resolves.toBeNull();

    const broken = fake(null, new ApiProblemError(500, {}));
    await expect(broken.service.getArchiveTournament('t1')).rejects.toMatchObject({ status: 500 });
  });
});
