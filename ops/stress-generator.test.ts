import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { isArchiveTournamentLocked, validateEnvironment } from '../scripts/dev-environments.mjs';
// @ts-expect-error - the stress generator is a plain ESM module shared with the seeding scripts.
import { ARCHIVE_ANCHOR_DATE, countBySeasonSizeClass, countByTier, DEGENERATE_TOURNAMENT_NAMES, generateStressEnvironment, MAXIMUM_TOURNAMENT_BYTES, mulberry32, playerNamePool, SEASON_SIZE_CLASSES, STRESS_VOLUMES, writeStressEnvironment } from '../scripts/generate-stress-environment.mjs';

/**
 * T29 stress environment: the French tournament circuit, simulated.
 *
 * The dataset itself is gitignored and takes minutes to seed, so this is the gate that has to catch a
 * broken generator: the counts, the shapes `validateEnvironment` refuses, the four tiers of event the
 * circuit is made of, the byte limit the domain refuses a Tournament document over, and above all the
 * promise the environment is worth nothing without — the same seed produces the same bytes on any
 * machine. The file-writing cases run at a fraction of the real volume, because what they check is the
 * writer, not the size.
 */

interface StressArchiveLeague {
  id: string;
  name: string;
  createdAt: string;
  sourceSeriesId: null;
}

interface StressArchiveLeagueSeason {
  id: string;
  name: string;
  leagueId: string;
  status: string;
  sizeClass?: string;
}

interface StressArchiveTournament {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;
  status: string;
  rounds: { entries: Record<string, unknown>[] }[];
  playerArchetypes: { playerName: string; archetype: string }[];
}

/** The legacy tier is reduced to what `live-tournaments.json` needs to resolve its `leagueKey`. */
interface StressLegacyLeague {
  id: string;
  name: string;
  status: string;
  tournaments: unknown[];
}

interface StressEvent {
  key: string;
  title: string;
  startsAtLocalOffsetDays: number;
  formatKeys: string[];
  tier: string;
  city: string;
  country: string;
  region: string;
  eventType: 'weekly' | 'monthly' | 'major';
}

interface StressDataset {
  accounts: { email: string; role: string; emailConfirmed?: boolean }[];
  organizations: { key: string; memberEmails: string[] }[];
  formats: { key: string; slug: string }[];
  tournaments: Omit<StressEvent, 'tier'>[];
  events: StressEvent[];
  registrations: { tournamentKey: string; userEmail: string }[];
  leagues: StressLegacyLeague[];
  archiveLeagues: StressArchiveLeague[];
  archiveLeagueSeasons: StressArchiveLeagueSeason[];
  archiveTournaments: StressArchiveTournament[];
  leagueSeasonsBySizeClass: StressArchiveLeagueSeason[];
  liveTournaments: { key: string; players: { name: string }[]; leagueKey: string | null }[];
  auditRecords: { action: string; entityType: string }[];
  [key: string]: unknown;
}

/** The declared "today" the generated archive is dated against; the lock window is measured off it. */
const ANCHOR = new Date(`${ARCHIVE_ANCHOR_DATE}T00:00:00Z`);

const REDUCED_SCALE = 0.05;
const generate = (seed: number, scale = 1): StressDataset => generateStressEnvironment({ seed, scale }) as StressDataset;

let sharedArchive: StressDataset | undefined;
/**
 * One full-scale dataset, shared by the read-only archive cases below. The generator is a pure
 * function of its seed, and generating the whole circuit once per archive case would multiply this
 * file's runtime without covering one extra line.
 */
const archiveData = (): StressDataset => (sharedArchive ??= generate(1));

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

function playerNames(tournaments: StressArchiveTournament[]): Set<string> {
  const names = new Set<string>();
  for (const tournament of tournaments) {
    for (const round of tournament.rounds) {
      for (const entry of round.entries) {
        for (const key of ['player1Name', 'player2Name', 'playerName']) {
          if (typeof entry[key] === 'string') names.add(entry[key] as string);
        }
      }
    }
  }
  return names;
}

/** The seat counts of one club Season, which is where "the same faces plus a few electrons" has to show. */
function seatsPerPlayer(tournaments: StressArchiveTournament[]): Map<string, number> {
  const seats = new Map<string, number>();
  for (const tournament of tournaments) {
    for (const { playerName } of tournament.playerArchetypes) seats.set(playerName, (seats.get(playerName) ?? 0) + 1);
  }
  return seats;
}

const playedIn = (data: StressDataset, seasonId: string): StressArchiveTournament[] =>
  data.archiveTournaments.filter((tournament) => tournament.seasonId === seasonId);
const nonAscii = (value: string): boolean => !/^[\x20-\x7e]*$/.test(value);

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('the stress environment generator', () => {
  it('is deterministic', () => {
    const first = writeInto(generate(1, REDUCED_SCALE));
    const second = writeInto(generate(1, REDUCED_SCALE));

    expect(readAll(first)).toEqual(readAll(second));
    expect(Object.keys(readAll(first))).toContain('archive-tournaments.json');
  });

  it('differs by seed', () => {
    const first = readAll(writeInto(generate(1, REDUCED_SCALE)));
    const second = readAll(writeInto(generate(2, REDUCED_SCALE)));

    expect(second).not.toEqual(first);
    // The formats are the real French catalog and the clubs are placed on a fixed map, so those two are
    // what a seed does not move; every file that carries a draw has to.
    expect(second['archive-tournaments.json']).not.toEqual(first['archive-tournaments.json']);
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
    expect(within10Percent(data.archiveLeagues.length, 65), `archive Leagues: ${data.archiveLeagues.length}`).toBe(true);
    expect(within10Percent(data.archiveLeagueSeasons.length, 190), `League Seasons: ${data.archiveLeagueSeasons.length}`).toBe(true);
    expect(within10Percent(data.archiveTournaments.length, 2200), `archive Tournaments: ${data.archiveTournaments.length}`).toBe(true);
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

  it('maps every circuit tier to app-owned Region and Event Type', () => {
    const events = generate(1).events;
    expect(events.every((event) => typeof event.region === 'string' && event.region.length > 0)).toBe(true);
    expect(events.filter((event) => event.tier === 'local').every((event) => event.eventType === 'weekly')).toBe(true);
    expect(events.filter((event) => event.tier === 'monthly').every((event) => event.eventType === 'monthly')).toBe(true);
    expect(events.filter((event) => event.tier === 'regional' || event.tier === 'national').every((event) => event.eventType === 'major')).toBe(true);
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
    const fields = generate(1).archiveTournaments.map((tournament) => tournament.playerArchetypes.length);
    const share = (predicate: (size: number) => boolean) => fields.filter(predicate).length / fields.length;

    // Measured on 886 French paper events published on mtgtop8 between 2025-01 and 2026-08:
    // 75% at 8-30 players, 21% at 31-100, 3% at 101-300, 1% above.
    expect(Math.min(...fields)).toBeGreaterThanOrEqual(8);
    expect(share((size) => size <= 30)).toBeGreaterThan(0.6);
    expect(share((size) => size > 30 && size <= 100)).toBeGreaterThan(0.1);
    expect(share((size) => size > 100 && size <= 300)).toBeGreaterThan(0.01);
    expect(Math.max(...fields)).toBeGreaterThanOrEqual(1000);
  });

  it('keeps every Tournament document under the size the domain reads back', () => {
    // The bulk loader writes rows the domain never validated, so a document over
    // `ArchiveTournament.MaximumDocumentBytes` would only surface as a crashed statistics rebuild.
    // The megabyte is per Tournament now, not per League.
    for (const tournament of generate(1).archiveTournaments) {
      const bytes = Buffer.byteLength(JSON.stringify(tournament), 'utf8');
      expect(bytes, `${tournament.id}: ${bytes} bytes`).toBeLessThan(MAXIMUM_TOURNAMENT_BYTES);
    }
  });

  it('seats the same core week after week, with a tail of one-off entrants', () => {
    const data = generate(1);
    // Club Leagues are generated first, so the first weekly-class Season is a club's own weekly legs —
    // the one tier where the same faces are supposed to come back.
    const season = data.leagueSeasonsBySizeClass.find((entry) => entry.sizeClass === 'weekly');
    expect(season, 'the first weekly-class Season').toBeDefined();

    const played = playedIn(data, (season as StressArchiveLeagueSeason).id);
    const seats = seatsPerPlayer(played);
    const nights = played.length;
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

  it('gives every Season at least one completed Tournament', () => {
    const data = generate(1);

    expect(data.archiveLeagueSeasons.length).toBeGreaterThan(0);
    for (const season of data.archiveLeagueSeasons) {
      // An `active` Tournament contributes to no player-statistics scope, so a Season made only of them
      // would rank nobody.
      expect(playedIn(data, season.id).filter((tournament) => tournament.status === 'completed').length, season.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps every archive Tournament pointed at a Season that exists', () => {
    // A dangling Season reference is a foreign-key violation the bulk loader would only hit mid-COPY,
    // with the previous dataset already dropped.
    const data = generate(1);
    const seasonIds = new Set(data.archiveLeagueSeasons.map(({ id }) => id));

    for (const tournament of data.archiveTournaments) {
      expect(tournament.seasonId === null || seasonIds.has(tournament.seasonId), tournament.id).toBe(true);
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
    const names = playerNames(generate(1).archiveTournaments);

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

  it('gives every generated League a null sourceSeriesId', () => {
    // Public archives expose no series field at all; the League tier is this project's own construct.
    for (const league of archiveData().archiveLeagues) {
      expect(Object.hasOwn(league, 'sourceSeriesId'), league.id).toBe(true);
      expect(league.sourceSeriesId, league.id).toBeNull();
    }
  });

  it('points every generated Season at a League that exists', () => {
    const data = archiveData();
    const leagueIds = new Set(data.archiveLeagues.map(({ id }) => id));

    expect(data.archiveLeagueSeasons.length).toBeGreaterThan(0);
    for (const season of data.archiveLeagueSeasons) expect(leagueIds, season.id).toContain(season.leagueId);
  });

  it('runs the full spread of Season sizes the public archives report', () => {
    const data = archiveData();
    const counted = countBySeasonSizeClass(data.leagueSeasonsBySizeClass) as Record<string, number>;
    const sizes = data.archiveLeagueSeasons.map((season) => playedIn(data, season.id).length);

    for (const { key } of SEASON_SIZE_CLASSES as { key: string }[]) {
      expect(counted[key] ?? 0, key).toBeGreaterThanOrEqual(1);
    }
    // A World Championship is one event; a Grand Prix season late in its life is sixty. Both have to be
    // in the dataset, or the archive pages are only ever judged against a middling Season.
    expect(sizes.some((size) => size === 1), 'a one-event Season').toBe(true);
    expect(sizes.some((size) => size >= 3 && size <= 4), 'a Pro Tour sized Season').toBe(true);
    expect(sizes.some((size) => size >= 8 && size <= 11), 'a Spotlight sized Season').toBe(true);
    expect(sizes.some((size) => size >= 50), 'a late Grand Prix sized Season').toBe(true);
  });

  it('labels Seasons with free strings, not years', () => {
    const labels = archiveData().archiveLeagueSeasons.map(({ name }) => name);
    const matches = (pattern: RegExp): boolean => labels.some((label) => pattern.test(label));

    // A Season name is a free string. Every one of these styles is real, and none of them is a column.
    expect(matches(/^\d{4}$/), 'a bare year').toBe(true);
    expect(matches(/^\d{4}-\d{2}$/), 'a cross-year label').toBe(true);
    expect(matches(/^Season \d+$/), 'a numbered season').toBe(true);
    expect(matches(/^Season \d+ - Round \d+$/), 'a numbered leg').toBe(true);
    expect(matches(/^\d{4}\/\d$/), 'a year/leg label').toBe(true);
    expect(labels.filter((label) => !/^\d{4}$/.test(label)).length / labels.length).toBeGreaterThan(0.25);
  });

  it('runs at least one Season across a calendar year boundary', () => {
    const data = archiveData();
    const crossing = data.archiveLeagueSeasons.filter((season) => {
      const years = new Set(playedIn(data, season.id).map((tournament) => tournament.tournamentDate.slice(0, 4)));
      return years.size > 1;
    });

    expect(crossing.length).toBeGreaterThanOrEqual(1);
    for (const season of crossing) {
      const played = playedIn(data, season.id);
      expect(played[0].tournamentDate.slice(0, 4), season.id).not.toBe(played[played.length - 1].tournamentDate.slice(0, 4));
    }
  });

  it('emits standalone Tournaments with no Season', () => {
    const standalone = archiveData().archiveTournaments.filter((tournament) => tournament.seasonId === null);

    expect(standalone).toHaveLength(STRESS_VOLUMES.standaloneTournaments as number);
    // "Series", "1K", "FNM" — names carrying no series signal at all. The archive is full of them, and
    // a heuristic that grouped them into Leagues would invent series nobody ran.
    for (const name of DEGENERATE_TOURNAMENT_NAMES as string[]) {
      expect(standalone.map((tournament) => tournament.name), name).toContain(name);
    }
  });

  it('never turns a degenerate name into a League or a Season', () => {
    const data = archiveData();
    const degenerate = DEGENERATE_TOURNAMENT_NAMES as string[];

    for (const league of data.archiveLeagues) expect(degenerate, league.id).not.toContain(league.name);
    for (const season of data.archiveLeagueSeasons) expect(degenerate, season.id).not.toContain(season.name);
  });

  it('ships a child series whose name embeds its parent\'s', () => {
    const labels = archiveData().archiveLeagues.map(({ name }) => name);

    expect(labels.some((child) => labels.some((parent) => parent !== child && child.startsWith(parent)))).toBe(true);
  });

  it('carries non-ASCII names at every tier', () => {
    const data = archiveData();

    expect(data.archiveLeagues.some((league) => nonAscii(league.name))).toBe(true);
    expect(data.archiveLeagueSeasons.some((season) => nonAscii(season.name))).toBe(true);
    expect(data.archiveTournaments.some((tournament) => nonAscii(tournament.name))).toBe(true);
  });

  it('reaches both sides of the lock window against the declared anchor', () => {
    const dates = archiveData().archiveTournaments.map(({ tournamentDate }) => tournamentDate);

    // Measured against the declared anchor, never the clock: the generator has to stay byte-identical
    // from one machine and one day to the next.
    expect(dates.some((date) => isArchiveTournamentLocked(date, ANCHOR))).toBe(true);
    expect(dates.some((date) => !isArchiveTournamentLocked(date, ANCHOR))).toBe(true);
  });

  it('never dates an archive Tournament after the anchor', () => {
    for (const tournament of archiveData().archiveTournaments) {
      expect(tournament.tournamentDate <= (ARCHIVE_ANCHOR_DATE as string), tournament.id).toBe(true);
    }
  });

  it('points every running tournament at a LeagueSeason of this archive, or at none', () => {
    const data = archiveData();
    const referenced = data.liveTournaments.map((live) => live.leagueKey).filter((key) => key !== null);
    const seasons = new Set(data.archiveLeagueSeasons.map(({ id }) => id));

    // T19 retired the legacy stub Leagues these used to point at; `leagueKey` now names a Season the
    // same environment restores, which is what `POST /api/live-tournaments` resolves it against.
    expect(referenced.length).toBeGreaterThan(0);
    for (const key of referenced) expect(seasons, key).toContain(key);
    expect(data.liveTournaments.some((live) => live.leagueKey === null)).toBe(true);
  });

  it('still validates as a whole environment', () => {
    expect(validateEnvironment({
      name: 'stress',
      directory: 'stress',
      description: 'The French circuit for a season, for design stress testing. Generated, not committed.',
      resetDatabase: true,
      ...archiveData()
    }, { today: ANCHOR })).toEqual([]);
  });
});
