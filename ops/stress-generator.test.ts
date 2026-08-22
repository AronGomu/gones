import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { validateEnvironment } from '../scripts/dev-environments.mjs';
// @ts-expect-error - the stress generator is a plain ESM module shared with the seeding scripts.
import { countByTier, generateStressEnvironment, MAXIMUM_LEAGUE_BYTES, mulberry32, playerNamePool, STRESS_VOLUMES, writeStressEnvironment } from '../scripts/generate-stress-environment.mjs';

/**
 * T29 stress environment: the French tournament circuit, simulated.
 *
 * The dataset itself is gitignored and takes minutes to seed, so this is the gate that has to catch a
 * broken generator: the counts, the shapes `validateEnvironment` refuses, the four tiers of event the
 * circuit is made of, the byte limit the domain refuses a League document over, and above all the
 * promise the environment is worth nothing without — the same seed produces the same bytes on any
 * machine. The file-writing cases run at a fraction of the real volume, because what they check is the
 * writer, not the size.
 */

interface StressLeague {
  id: string;
  name: string;
  status: string;
  tournaments: {
    id: string;
    leagueId: string;
    status: string;
    rounds: { entries: Record<string, unknown>[] }[];
    playerArchetypes: { playerName: string; archetype: string }[];
  }[];
}

interface StressEvent {
  key: string;
  title: string;
  startsAtLocalOffsetDays: number;
  formatKeys: string[];
  tier: string;
  city: string;
  country: string;
}

interface StressDataset {
  accounts: { email: string; role: string; emailConfirmed?: boolean }[];
  organizations: { key: string; memberEmails: string[] }[];
  formats: { key: string; slug: string }[];
  tournaments: Omit<StressEvent, 'tier'>[];
  events: StressEvent[];
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

/** The seat counts of one club season, which is where "the same faces plus a few electrons" has to show. */
function seatsPerPlayer(league: StressLeague): Map<string, number> {
  const seats = new Map<string, number>();
  for (const tournament of league.tournaments) {
    for (const { playerName } of tournament.playerArchetypes) seats.set(playerName, (seats.get(playerName) ?? 0) + 1);
  }
  return seats;
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
    // The formats are the real French catalog and the clubs are placed on a fixed map, so those two are
    // what a seed does not move; every file that carries a draw has to.
    expect(second['leagues.json']).not.toEqual(first['leagues.json']);
    expect(second['accounts.json']).not.toEqual(first['accounts.json']);
    expect(second['tournaments.json']).not.toEqual(first['tournaments.json']);
  });

  it('hits the target volumes', () => {
    const data = generate(1);
    const within10Percent = (actual: number, target: number) => Math.abs(actual - target) <= target * 0.1;

    expect(within10Percent(data.accounts.length, 700), `accounts: ${data.accounts.length}`).toBe(true);
    expect(data.organizations.length, `clubs: ${data.organizations.length}`).toBe(STRESS_VOLUMES.clubs);
    expect(within10Percent(data.tournaments.length, 3800), `Events: ${data.tournaments.length}`).toBe(true);
    expect(within10Percent(data.registrations.length, 2300), `registrations: ${data.registrations.length}`).toBe(true);
    expect(within10Percent(data.leagues.length, 185), `leagues: ${data.leagues.length}`).toBe(true);
  });

  it('produces valid fixtures', () => {
    const data = generate(1);

    expect(validateEnvironment({
      name: 'stress',
      directory: 'stress',
      description: 'The French circuit for a season, for design stress testing. Generated, not committed.',
      resetDatabase: true,
      ...data
    })).toEqual([]);
  });

  it('runs the four tiers of the French circuit at their own cadence', () => {
    const tiers = countByTier(generate(1).events) as Record<string, number>;
    const { local, monthly, regional, national } = tiers;

    // Weekly locals are most of a calendar; the national is once a year, so the window holds two.
    expect(local).toBeGreaterThan(monthly);
    expect(monthly).toBeGreaterThan(regional);
    expect(regional).toBeGreaterThan(national);
    expect(national).toBe(2);
    // Every two months in each of the twelve régions the survey found, over the whole window.
    expect(regional).toBeGreaterThanOrEqual(12 * 6);
  });

  it('fields the tiers at the sizes the real circuit reports', () => {
    const fields = generate(1).leagues.flatMap((league) => league.tournaments.map((tournament) => tournament.playerArchetypes.length));
    const share = (predicate: (size: number) => boolean) => fields.filter(predicate).length / fields.length;

    // Measured on 886 French paper events published on mtgtop8 between 2025-01 and 2026-08:
    // 75% at 8-30 players, 21% at 31-100, 3% at 101-300, 1% above.
    expect(Math.min(...fields)).toBeGreaterThanOrEqual(8);
    expect(share((size) => size <= 30)).toBeGreaterThan(0.6);
    expect(share((size) => size > 30 && size <= 100)).toBeGreaterThan(0.1);
    expect(share((size) => size > 100 && size <= 300)).toBeGreaterThan(0.01);
    expect(Math.max(...fields)).toBeGreaterThanOrEqual(1000);
  });

  it('keeps every League document under the size the domain reads back', () => {
    // The bulk loader writes rows the domain never validated, so a document over
    // `LeagueArchiveAggregate.MaximumDocumentBytes` would only surface as a crashed statistics rebuild.
    for (const league of generate(1).leagues) {
      const bytes = Buffer.byteLength(JSON.stringify(league), 'utf8');
      expect(bytes, `${league.id}: ${bytes} bytes`).toBeLessThan(MAXIMUM_LEAGUE_BYTES);
    }
  });

  it('seats the same core week after week, with a tail of one-off entrants', () => {
    const season = generate(1).leagues.find((league) => league.id === 'stress-league-000-s01');
    expect(season, 'the first club season').toBeDefined();

    const seats = seatsPerPlayer(season as StressLeague);
    const nights = (season as StressLeague).tournaments.length;
    const total = [...seats.values()].reduce((sum, count) => sum + count, 0);
    const core = [...seats.values()].filter((count) => count >= nights / 2);
    const once = [...seats.values()].filter((count) => count === 1);

    // The measured shape of a French weekly: a dozen names take about half the seats, and behind them
    // sits a longer tail of players seen once.
    expect(core.length).toBeGreaterThanOrEqual(8);
    expect(core.length).toBeLessThanOrEqual(25);
    expect(core.reduce((sum, count) => sum + count, 0) / total).toBeGreaterThan(0.35);
    expect(once.length).toBeGreaterThan(core.length);
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

  it('repeats a club local on the same weekday, whatever weekday the seeding lands on', () => {
    const data = generate(1);
    const locals = data.events.filter((event) => event.tier === 'local' && event.key.startsWith('stress-local-000-'));

    expect(locals.length).toBeGreaterThan(10);
    // A Calendar offset is relative to the seeding day, so the fixture cannot name a weekday — what it
    // can guarantee is the rhythm: one slot per club, seven days apart.
    const slots = new Set(locals.map((event) => ((event.startsAtLocalOffsetDays % 7) + 7) % 7));
    expect(slots.size).toBe(1);
  });

  it('gives every event a unique title, so none is read as a split Event', () => {
    const titles = generate(1).tournaments.map((event) => event.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it('runs the whole circuit in France', () => {
    const data = generate(1);

    expect(new Set(data.tournaments.map((event) => event.country))).toEqual(new Set(['France']));
    // Twelve régions, and the national at Châteauroux where the Championnat de France really is played.
    expect(new Set(data.tournaments.map((event) => event.city)).size).toBeGreaterThan(30);
    expect(data.tournaments.some((event) => event.title.startsWith('Championnat de France') && event.city === 'Châteauroux')).toBe(true);
  });

  it('caps audit rows', () => {
    expect(generate(1).auditRecords.length).toBeLessThanOrEqual(10_000);
  });

  it('keeps player names in a bounded pool', () => {
    const names = playerNames(generate(1).leagues);

    // Bounded so rankings and player pages have depth: the same cast recurs across Leagues instead of
    // every Match introducing a stranger.
    expect(names.size).toBeLessThanOrEqual(STRESS_VOLUMES.playerPool);
    expect(names.size).toBeGreaterThan(100);
  });

  it('crosses its name lists into a pool with no duplicate', () => {
    // A pool with a repeat would silently shrink every roster drawn from it, and the national needs a
    // thousand distinct names in one field.
    const pool = playerNamePool(STRESS_VOLUMES.playerPool) as string[];

    expect(new Set(pool).size).toBe(STRESS_VOLUMES.playerPool);
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
