import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { validateEnvironment } from '../scripts/dev-environments.mjs';
// @ts-expect-error - the stress generator is a plain ESM module shared with the seeding scripts.
import { generateStressEnvironment, mulberry32, STRESS_VOLUMES, writeStressEnvironment } from '../scripts/generate-stress-environment.mjs';

/**
 * T29 hundredfold stress environment.
 *
 * The dataset itself is gitignored and takes minutes to seed, so this is the gate that has to catch a
 * broken generator: the counts, the shapes `validateEnvironment` refuses, and above all the promise the
 * environment is worth nothing without — the same seed produces the same bytes on any machine. The
 * file-writing cases run at a fraction of the real volume, because what they check is the writer, not
 * the size.
 */

interface StressLeague {
  id: string;
  name: string;
  status: string;
  tournaments: { id: string; leagueId: string; status: string; rounds: { entries: Record<string, unknown>[] }[] }[];
}

interface StressDataset {
  accounts: { email: string; role: string; emailConfirmed?: boolean }[];
  organizations: { key: string; memberEmails: string[] }[];
  formats: { key: string; slug: string }[];
  tournaments: { key: string; startsAtLocalOffsetDays: number; formatKeys: string[] }[];
  registrations: { tournamentKey: string; userEmail: string }[];
  leagues: StressLeague[];
  liveTournaments: { key: string; players: { name: string }[] }[];
  auditRecords: { action: string; entityType: string }[];
  [key: string]: unknown;
}

const REDUCED_SCALE = 0.05;
const generate = (seed: number, scale = 1): StressDataset => generateStressEnvironment({ seed, scale }) as StressDataset;

const directories: string[] = [];
function writeInto(data: StressDataset): string {
  const directory = mkdtempSync(join(tmpdir(), 'gones-stress-'));
  directories.push(directory);
  writeStressEnvironment(data, directory);
  return directory;
}

function readAll(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).sort().map((file) => [file, readFileSync(join(directory, file), 'utf8')]));
}

function playerNames(leagues: StressLeague[]): Set<string> {
  const names = new Set<string>();
  for (const league of leagues) {
    for (const tournament of league.tournaments) {
      for (const round of tournament.rounds) {
        for (const entry of round.entries) {
          for (const key of ['player1Name', 'player2Name', 'playerName']) {
            if (typeof entry[key] === 'string') names.add(entry[key] as string);
          }
        }
      }
    }
  }
  return names;
}

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('the stress environment generator', () => {
  it('is deterministic', () => {
    const first = writeInto(generate(1, REDUCED_SCALE));
    const second = writeInto(generate(1, REDUCED_SCALE));

    expect(readAll(first)).toEqual(readAll(second));
    expect(Object.keys(readAll(first))).toContain('leagues.json');
  });

  it('differs by seed', () => {
    const first = readAll(writeInto(generate(1, REDUCED_SCALE)));
    const second = readAll(writeInto(generate(2, REDUCED_SCALE)));

    expect(second).not.toEqual(first);
    // The formats are a catalog derived from the index alone, so they are the one file a seed does not
    // move; every file that carries a draw has to.
    expect(second['leagues.json']).not.toEqual(first['leagues.json']);
    expect(second['accounts.json']).not.toEqual(first['accounts.json']);
    expect(second['tournaments.json']).not.toEqual(first['tournaments.json']);
  });

  it('hits the target volumes', () => {
    const data = generate(1);
    const within5Percent = (actual: number, target: number) => Math.abs(actual - target) <= target * 0.05;

    expect(within5Percent(data.accounts.length, 700), `accounts: ${data.accounts.length}`).toBe(true);
    expect(within5Percent(data.organizations.length, 200), `organizations: ${data.organizations.length}`).toBe(true);
    expect(within5Percent(data.formats.length, 400), `formats: ${data.formats.length}`).toBe(true);
    expect(within5Percent(data.tournaments.length, 1600), `Events: ${data.tournaments.length}`).toBe(true);
    expect(within5Percent(data.registrations.length, 700), `registrations: ${data.registrations.length}`).toBe(true);
    expect(within5Percent(data.leagues.length, 200), `leagues: ${data.leagues.length}`).toBe(true);
  });

  it('produces valid fixtures', () => {
    const data = generate(1);

    expect(validateEnvironment({
      name: 'stress',
      directory: 'stress',
      description: 'Hundredfold dataset for design stress testing. Generated, not committed.',
      resetDatabase: true,
      ...data
    })).toEqual([]);
  });

  it('caps Live tournaments at ten', () => {
    expect(generate(1).liveTournaments).toHaveLength(10);
    expect(STRESS_VOLUMES.liveTournaments).toBe(10);
  });

  it('gives every league at least one completed tournament', () => {
    const leagues = generate(1).leagues;

    expect(leagues.length).toBeGreaterThan(0);
    for (const league of leagues) {
      expect(league.tournaments.filter((tournament) => tournament.status === 'completed').length, league.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps every archive tournament inside its own league', () => {
    // The one shape that crash-looped a stress experiment: a document the domain refuses on read, which
    // takes the startup statistics rebuild with it.
    for (const league of generate(1).leagues) {
      for (const tournament of league.tournaments) expect(tournament.leagueId, tournament.id).toBe(league.id);
    }
  });

  it('spreads events across past, today and future', () => {
    const offsets = generate(1).tournaments.map((event) => event.startsAtLocalOffsetDays);

    expect(offsets.filter((offset) => offset < 0).length).toBeGreaterThan(0);
    expect(offsets.filter((offset) => offset === 0).length).toBeGreaterThanOrEqual(1);
    expect(offsets.filter((offset) => offset > 0).length).toBeGreaterThan(0);
  });

  it('caps audit rows', () => {
    expect(generate(1).auditRecords.length).toBeLessThanOrEqual(10_000);
  });

  it('keeps player names in a bounded pool', () => {
    const names = playerNames(generate(1).leagues);

    // Bounded so rankings and player pages have depth: the same cast recurs across Leagues instead of
    // every Match introducing a stranger.
    expect(names.size).toBeLessThanOrEqual(2000);
    expect(names.size).toBeGreaterThan(100);
  });

  it('mulberry32 is a pure function of its seed', () => {
    const first = Array.from({ length: 5 }, mulberry32(7) as () => number);
    const second = Array.from({ length: 5 }, mulberry32(7) as () => number);

    expect(first).toEqual(second);
    expect(first).not.toEqual(Array.from({ length: 5 }, mulberry32(8) as () => number));
    for (const value of first) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of first) expect(value).toBeLessThan(1);
  });
});
