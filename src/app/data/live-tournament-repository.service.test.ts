import { beforeEach, describe, expect, it } from 'vitest';
import { LiveTournamentRepository } from './live-tournament-repository.service';

describe('LiveTournamentRepository', () => {
  let repository: LiveTournamentRepository;

  beforeEach(() => {
    localStorage.clear();
    repository = new LiveTournamentRepository();
  });

  it('stores created live tournaments locally', async () => {
    const created = await repository.create();

    await expect(repository.get(created.id)).resolves.toMatchObject({ id: created.id, name: created.name });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it('does not resurrect a deleted tournament from a stale save', async () => {
    const created = await repository.create();
    await repository.delete(created.id);

    await expect(repository.save(created)).rejects.toThrow('deletedLiveTournamentDocument');
    await expect(repository.get(created.id)).resolves.toBeNull();
  });
});
