import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import type { ArchiveTournamentEditBatch } from '../backend/local-archive-backend.service';
import type { PersistedArchiveTournament } from '../domain/archive-models';
import { ArchiveRepository } from './archive-repository.service';

function batch(): ArchiveTournamentEditBatch {
  return { editTournament: { name: 'B', tournamentDate: '2026-02-02' }, addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] };
}

function saved(overrides: Partial<PersistedArchiveTournament> = {}): PersistedArchiveTournament {
  return {
    id: 'server-1',
    name: 'B',
    seasonId: 's1',
    tournamentDate: '2026-02-02',
    status: 'active',
    rounds: [],
    playerArchetypes: [],
    documentVersion: 5,
    updatedAt: '2026-02-02T10:00:00Z',
    ...overrides
  };
}

/** The write ports, the power gate and a spied funnel. Nothing else of the repository is exercised. */
function build(options: { document?: PersistedArchiveTournament; rejectWith?: unknown; powerOff?: boolean } = {}) {
  const order: string[] = [];
  const port = (label: string) => ({
    applyArchiveTournamentEditBatch: vi.fn(async () => {
      order.push(`write:${label}`);
      if (options.rejectWith) throw options.rejectWith;
      return options.document ?? saved();
    }),
    getArchiveTournament: vi.fn(async () => {
      order.push(`read:${label}`);
      return options.document ?? saved();
    })
  });
  const localTournaments = port('local');
  const serverTournaments = port('server');
  const invalidateArchiveCaches = vi.fn(async () => { order.push('invalidate'); });
  const power = {
    requireEnabled: vi.fn(() => {
      if (options.powerOff) throw new Error('powerUserRequired');
    })
  };
  const repo = Object.create(ArchiveRepository.prototype) as ArchiveRepository;
  Object.assign(repo, { power, localTournaments, serverTournaments, cache: {}, invalidateArchiveCaches });
  return { repo, localTournaments, serverTournaments, invalidateArchiveCaches, power, order };
}

describe('ArchiveRepository.saveTournamentEdits', () => {
  it('routes a server id to the server port', async () => {
    const harness = build();
    const command = batch();
    await harness.repo.saveTournamentEdits({ tournamentId: 'server-1', expectedVersion: 4, batch: command });
    expect(harness.serverTournaments.applyArchiveTournamentEditBatch).toHaveBeenCalledTimes(1);
    expect(harness.serverTournaments.applyArchiveTournamentEditBatch).toHaveBeenCalledWith('server-1', 4, command);
    expect(harness.localTournaments.applyArchiveTournamentEditBatch).not.toHaveBeenCalled();
  });

  it('routes a local id to the browser store', async () => {
    const harness = build({ document: saved({ id: 'local-1' }) });
    await harness.repo.saveTournamentEdits({ tournamentId: 'local-1', expectedVersion: 4, batch: batch() });
    expect(harness.localTournaments.applyArchiveTournamentEditBatch).toHaveBeenCalledTimes(1);
    expect(harness.serverTournaments.applyArchiveTournamentEditBatch).not.toHaveBeenCalled();
  });

  it('refuses to write while Power mode is off', async () => {
    const harness = build({ powerOff: true });
    await expect(harness.repo.saveTournamentEdits({ tournamentId: 'server-1', expectedVersion: 4, batch: batch() }))
      .rejects.toThrow('powerUserRequired');
    expect(harness.serverTournaments.applyArchiveTournamentEditBatch).not.toHaveBeenCalled();
    expect(harness.localTournaments.applyArchiveTournamentEditBatch).not.toHaveBeenCalled();
    expect(harness.invalidateArchiveCaches).not.toHaveBeenCalled();
  });

  it('invalidates the archive caches after a successful write', async () => {
    const harness = build();
    await harness.repo.saveTournamentEdits({ tournamentId: 'server-1', expectedVersion: 4, batch: batch() });
    expect(harness.invalidateArchiveCaches).toHaveBeenCalledTimes(1);
    // Invalidating before the write would drop a good cache and refill it from data the write
    // had not yet changed, so the ORDER is the assertion, not the call count alone.
    expect(harness.order).toEqual(['write:server', 'invalidate']);
  });

  it('does not invalidate when the write failed', async () => {
    const harness = build({ rejectWith: new ApiProblemError(412, { code: 'stale_version' }) });
    await expect(harness.repo.saveTournamentEdits({ tournamentId: 'server-1', expectedVersion: 4, batch: batch() }))
      .rejects.toMatchObject({ status: 412, problem: { code: 'stale_version' } });
    expect(harness.invalidateArchiveCaches).not.toHaveBeenCalled();
  });

  it('returns the authoritative document unchanged', async () => {
    const document = saved({ documentVersion: 5 });
    const harness = build({ document });
    const result = await harness.repo.saveTournamentEdits({ tournamentId: 'server-1', expectedVersion: 4, batch: batch() });
    expect(result).toBe(document);
  });
});

describe('ArchiveRepository.getTournament', () => {
  it('reads a tournament from the store its id names', async () => {
    const harness = build();
    await harness.repo.getTournament('local-1');
    await harness.repo.getTournament('server-1');
    expect(harness.order).toEqual(['read:local', 'read:server']);
    expect(harness.invalidateArchiveCaches).not.toHaveBeenCalled();
  });
});
