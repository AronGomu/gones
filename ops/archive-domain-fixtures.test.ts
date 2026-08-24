import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { ARCHIVE_RESTORE_CAPS, buildArchiveBundle, isArchiveTournamentLocked, readEnvironment } from '../scripts/dev-environments.mjs';

/**
 * The frozen v5 archive bundle.
 *
 * `fixtures/archive-domain/v5/bundle.json` is not authored: it is `buildArchiveBundle` applied to the
 * `demo` environment, so the repository holds exactly one source of archive truth and the export /
 * import tickets have a contract sample that cannot drift from the fixtures it was cut from. The
 * manifest stamps its SHA-256 and the cases it covers; this file is the gate that keeps both honest.
 */

interface ArchiveLeague {
  id: string;
  name: string;
  createdAt: string;
}

interface ArchiveLeagueSeason {
  id: string;
  name: string;
  leagueId: string;
  status: string;
}

interface ArchiveTournament {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;
  status: string;
  playerArchetypes: { playerName: string; archetype: string }[];
}

interface ArchiveBundle {
  kind: string;
  version: number;
  leagues: ArchiveLeague[];
  leagueSeasons: ArchiveLeagueSeason[];
  tournaments: ArchiveTournament[];
}

const DIRECTORY = join(process.cwd(), 'fixtures', 'archive-domain', 'v5');
const bundleText = readFileSync(join(DIRECTORY, 'bundle.json'), 'utf8');
const bundle = JSON.parse(bundleText) as ArchiveBundle;
const manifest = JSON.parse(readFileSync(join(DIRECTORY, 'manifest.json'), 'utf8')) as Record<string, never>;

const DEGENERATE_NAMES = ['Series', '1K', 'FNM', 'Weekly'];
const nonAscii = (value: string): boolean => !/^[\x20-\x7e]*$/.test(value);
const playedIn = (seasonId: string): ArchiveTournament[] => bundle.tournaments.filter((entry) => entry.seasonId === seasonId);
const yearsOf = (played: ArchiveTournament[]): Set<string> => new Set(played.map((entry) => entry.tournamentDate.slice(0, 4)));

/**
 * Every `caseCounts` key, recomputed from the bundle itself. The manifest is a claim; this is the
 * measurement, and a mistyped count fails here rather than misleading the ticket that reads it.
 */
function recomputeCaseCounts(anchor: Date): Record<string, number> {
  const seasonSizes = bundle.leagueSeasons.map((entry) => playedIn(entry.id).length);
  const leagueNames = bundle.leagues.map(({ name }) => name);
  const leaguesById = new Map(bundle.leagues.map((entry) => [entry.id, entry]));
  const standalone = bundle.tournaments.filter((entry) => entry.seasonId === null || entry.seasonId === undefined);
  const names = [
    ...leagueNames,
    ...bundle.leagueSeasons.map(({ name }) => name),
    ...bundle.tournaments.map(({ name }) => name),
    ...bundle.tournaments.flatMap((entry) => entry.playerArchetypes.map(({ playerName }) => playerName))
  ];

  return {
    leagues: bundle.leagues.length,
    leagueSeasons: bundle.leagueSeasons.length,
    tournaments: bundle.tournaments.length,
    standaloneTournaments: standalone.length,
    emptySeasons: seasonSizes.filter((size) => size === 0).length,
    crossYearSeasons: bundle.leagueSeasons.filter((entry) => yearsOf(playedIn(entry.id)).size > 1).length,
    lockedTournaments: bundle.tournaments.filter((entry) => isArchiveTournamentLocked(entry.tournamentDate, anchor)).length,
    unlockedTournaments: bundle.tournaments.filter((entry) => !isArchiveTournamentLocked(entry.tournamentDate, anchor)).length,
    leaguesEmbeddingAnotherLeagueName: leagueNames.filter((child) => leagueNames.some((parent) => parent !== child && child.startsWith(parent))).length,
    seasonsEmbeddingTheirLeagueName: bundle.leagueSeasons.filter((entry) => entry.name.includes(leaguesById.get(entry.leagueId)?.name ?? '\u0000')).length,
    degenerateStandaloneNames: standalone.filter((entry) => DEGENERATE_NAMES.includes(entry.name)).length,
    nonAsciiNames: new Set(names.filter(nonAscii)).size,
    distinctSeasonSizes: new Set(seasonSizes).size
  };
}

describe('the golden v5 archive bundle', () => {
  it('the golden bundle is the demo environment assembled', () => {
    expect(bundle).toEqual(buildArchiveBundle(readEnvironment('demo')));
  });

  it('the golden bundle is serialized the way the manifest says', () => {
    expect(manifest['serialization']).toBe('JSON.stringify(bundle, null, 2) + LF');
    expect(bundleText).toBe(`${JSON.stringify(JSON.parse(bundleText), null, 2)}\n`);
  });

  it('the manifest stamps the bundle it ships', () => {
    expect(manifest['bundleSha256']).toBe(createHash('sha256').update(bundleText).digest('hex'));
    expect(String(manifest['bundleSha256'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the manifest declares version 5 everywhere', () => {
    expect(manifest['fixtureSet']).toBe('gones-archive-domain-v5');
    expect(manifest['fixtureVersion']).toBe(5);
    expect(manifest['archiveDataVersion']).toBe(5);
    expect(bundle.version).toBe(5);
    expect(bundle.kind).toBe('fullArchive');
  });

  it('the manifest records that public archives expose no series field', () => {
    const provenance = manifest['provenance'] as unknown as { sourceSeriesId: null; note: string };

    expect(provenance.sourceSeriesId).toBeNull();
    expect(typeof provenance.note).toBe('string');
    expect(provenance.note.length).toBeGreaterThan(0);
  });

  it('the manifest case counts match the bundle', () => {
    const anchorIso = String(manifest['anchorDate']);
    const recomputed = recomputeCaseCounts(new Date(`${anchorIso}T00:00:00Z`));
    const claimed = manifest['caseCounts'] as unknown as Record<string, number>;

    expect(anchorIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(claimed).sort()).toEqual(Object.keys(recomputed).sort());
    for (const [key, value] of Object.entries(claimed)) expect(recomputed[key], key).toBe(value);
  });

  it('the bundle carries no fixture-only field', () => {
    // `sourceSeriesId` is a fixture-side provenance marker; it never reaches the wire or the database.
    for (const entry of bundle.leagues) expect(Object.keys(entry), entry.id).toEqual(['id', 'name', 'createdAt']);
  });

  it('the golden bundle is a body the restore endpoint would accept', () => {
    const caps = ARCHIVE_RESTORE_CAPS as { leagues: number; leagueSeasons: number; tournaments: number };
    const leagueIds = new Set(bundle.leagues.map(({ id }) => id));
    const seasonIds = new Set(bundle.leagueSeasons.map(({ id }) => id));

    expect(bundle.leagues.length).toBeLessThanOrEqual(caps.leagues);
    expect(bundle.leagueSeasons.length).toBeLessThanOrEqual(caps.leagueSeasons);
    expect(bundle.tournaments.length).toBeLessThanOrEqual(caps.tournaments);
    // Restore refuses a bundle link that does not resolve inside the bundle itself.
    for (const entry of bundle.leagueSeasons) expect(leagueIds, entry.id).toContain(entry.leagueId);
    for (const entry of bundle.tournaments) {
      if (entry.seasonId !== null && entry.seasonId !== undefined) expect(seasonIds, entry.id).toContain(entry.seasonId);
    }
  });
});
