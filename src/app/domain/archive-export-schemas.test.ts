import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DATA_VERSION,
  ARCHIVE_EXPORT_JSON_SCHEMA,
  ARCHIVE_EXPORT_LIMITS,
  ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS,
  archiveBundleFilename,
  attachArchiveChecksum,
  buildArchiveBundle,
  parseArchiveBundle,
  SUPPORTED_ARCHIVE_IMPORT_VERSIONS,
  verifyArchiveChecksum
} from './archive-export-schemas';
import { PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS } from './export-schemas';
import type { ArchiveBundle } from './archive-models';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/archive-export/v5');

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function goldenSource() {
  return {
    leagues: [
      { id: 'archive-league-1', name: 'Lyon Circuit', createdAt: '2025-01-06T09:00:00.000Z' },
      { id: 'archive-league-2', name: 'Grenoble Circuit', createdAt: '2025-02-10T09:00:00.000Z' }
    ],
    leagueSeasons: [
      { id: 'season-1', name: 'Lyon 2025', leagueId: 'archive-league-1', status: 'completed' as const },
      { id: 'season-2', name: 'Lyon 2026', leagueId: 'archive-league-1', status: 'active' as const },
      { id: 'season-3', name: 'Grenoble 2026', leagueId: 'archive-league-2', status: 'active' as const }
    ],
    tournaments: [
      {
        id: 'tournament-1', name: 'Lyon Opener', seasonId: 'season-1',
        tournamentDate: '2025-03-08', status: 'completed' as const,
        rounds: [{ id: 'round-1', entries: [
          { kind: 'match' as const, id: 'match-1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Red Aggro', player2DeckArchetype: 'Blue Control' },
          { kind: 'bye' as const, id: 'bye-1', table: '2', playerName: 'Carol', deckArchetype: 'Green Ramp' }
        ] }],
        playerArchetypes: [
          { playerName: 'Alice', archetype: 'Red Aggro' },
          { playerName: 'Bob', archetype: 'Blue Control' },
          { playerName: 'Carol', archetype: 'Green Ramp' }
        ]
      },
      {
        id: 'tournament-2', name: 'Lyon Finals', seasonId: 'season-1',
        tournamentDate: '2025-11-22', status: 'completed' as const, rounds: [], playerArchetypes: []
      },
      {
        id: 'tournament-3', name: 'Grenoble Open', seasonId: 'season-3',
        tournamentDate: '2026-04-11', status: 'active' as const,
        rounds: [{ id: 'round-3', entries: [
          { kind: 'invalid' as const, id: 'invalid-1', rawText: 'bad,row', table: '', player: 'Dana', result: '???', opponent: 'Eve', playerDecklist: '', opponentDecklist: '' }
        ] }],
        playerArchetypes: []
      },
      {
        id: 'tournament-4', name: 'Standalone Charity Cup', seasonId: null,
        tournamentDate: '2026-06-01', status: 'completed' as const,
        rounds: [{ id: 'round-4', entries: [
          { kind: 'match' as const, id: 'match-4', table: '1', player1Name: 'Alice', player2Name: 'Dana', player1Score: 1, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' }
        ] }],
        playerArchetypes: [{ playerName: 'Dana', archetype: '' }]
      }
    ],
    calendarEvents: [{
      id: 'event-1', slug: 'lyon-opener-2025', title: 'Lyon Opener', eventDate: '2025-03-08',
      startTime: '10:00', endTime: '18:00', location: 'Club Lyon', country: 'FR', city: 'Lyon',
      address: '1 rue de la Republique', description: 'Season opener',
      richDescriptionHtml: '<p>Season opener</p>', externalLink: 'https://example.org/lyon'
    }]
  };
}

function goldenBundle(): ArchiveBundle {
  return buildArchiveBundle(goldenSource());
}

/** Hand-authored so this fixture set has no import from the v1–v4 modules T17 removes. */
const LEGACY_V1_FIXTURE = {
  version: 1,
  exportedAt: '2024-05-04T12:00:00.000Z',
  league: { id: 'legacy-league', name: 'Legacy League', status: 'finished', tournaments: [] }
};

const LEGACY_V4_FIXTURE = {
  kind: 'fullData',
  gonesDataVersion: 4,
  gonesAppVersion: '0.1.0',
  exportedAt: '2026-01-15T00:00:00.000Z',
  leagues: [{ id: 'legacy-league', name: 'Legacy League', status: 'completed', tournaments: [] }],
  calendarEvents: []
};

/** Deep clone of the golden artifact as loosely-typed JSON, so a malformed-row case can edit it. */
function goldenPayload(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(goldenBundle()));
}

function rows(payload: Record<string, unknown>, collection: string): Record<string, unknown>[] {
  return payload[collection] as Record<string, unknown>[];
}

describe('archive export bundle v5', () => {
  it('pins the archive data version to 5 and the import allowlist to [5]', () => {
    expect(ARCHIVE_DATA_VERSION).toBe(5);
    expect([...SUPPORTED_ARCHIVE_IMPORT_VERSIONS]).toEqual([5]);
  });

  it('builds four flat collections and nothing else', () => {
    expect(Object.keys(goldenBundle()).sort()).toEqual(['calendarEvents', 'leagueSeasons', 'leagues', 'tournaments', 'version']);
  });

  it('stores no Tournaments inside a LeagueSeason and no Seasons inside a League', () => {
    const bundle = goldenBundle();

    for (const league of bundle.leagues) expect(Object.keys(league).sort()).toEqual(['createdAt', 'id', 'name']);
    for (const season of bundle.leagueSeasons) expect(Object.keys(season).sort()).toEqual(['id', 'leagueId', 'name', 'status']);
  });

  it('keeps a standalone Tournament as a top-level row with seasonId null', () => {
    const standalone = goldenBundle().tournaments.filter((tournament) => tournament.seasonId === null);

    expect(standalone).toHaveLength(1);
    expect(standalone[0].id).toBe('tournament-4');
  });

  it('never writes documentVersion, updatedAt or eTag', () => {
    const metadata = { documentVersion: 9, updatedAt: '2026-01-01T00:00:00.000Z', eTag: 'W/"9"' };
    const source = goldenSource();
    const bundle = buildArchiveBundle({
      leagues: source.leagues.map((league) => ({ ...league, ...metadata })),
      leagueSeasons: source.leagueSeasons.map((season) => ({ ...season, ...metadata })),
      tournaments: source.tournaments.map((tournament) => ({ ...tournament, ...metadata })),
      calendarEvents: source.calendarEvents
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('documentVersion');
    expect(serialized).not.toContain('updatedAt');
    expect(serialized).not.toContain('eTag');
  });

  it('orders every collection by id ascending', () => {
    const source = goldenSource();
    const bundle = buildArchiveBundle({
      leagues: [...source.leagues].reverse(),
      leagueSeasons: [...source.leagueSeasons].reverse(),
      tournaments: [...source.tournaments].reverse(),
      calendarEvents: [...source.calendarEvents].reverse()
    });

    for (const collection of [bundle.leagues, bundle.leagueSeasons, bundle.tournaments, bundle.calendarEvents]) {
      const ids = collection.map((row) => row.id);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it('publishes a closed v5 JSON Schema', () => {
    expect(ARCHIVE_EXPORT_JSON_SCHEMA.$id).toBe('https://gones.app/schemas/archive-export-v5.json');
    expect(ARCHIVE_EXPORT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...ARCHIVE_EXPORT_JSON_SCHEMA.required]).toEqual(['version', 'leagues', 'leagueSeasons', 'tournaments', 'calendarEvents']);
    expect(Object.keys(ARCHIVE_EXPORT_JSON_SCHEMA.properties).sort()).toEqual(['calendarEvents', 'checksum', 'leagueSeasons', 'leagues', 'tournaments', 'version']);
  });

  it('keeps the schema and the parser agreed on the accepted top-level keys', async () => {
    const accepted = Object.keys(ARCHIVE_EXPORT_JSON_SCHEMA.properties);
    const artifact = await attachArchiveChecksum(goldenBundle()) as unknown as Record<string, unknown>;

    expect(Object.keys(artifact).every((key) => accepted.includes(key))).toBe(true);
    expect(parseArchiveBundle(artifact)).toEqual(goldenBundle());
    expect(() => parseArchiveBundle({ ...artifact, extra: 1 })).toThrow('unsupportedArchiveBundle');
  });

  it('keeps the v5 calendar event fields identical to the v4 public allowlist', () => {
    expect([...ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS]).toEqual([...PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS]);
  });

  it('round-trips a bundle through serialize and parse unchanged', async () => {
    const golden = goldenBundle();

    expect(parseArchiveBundle(JSON.parse(JSON.stringify(await attachArchiveChecksum(golden))))).toEqual(golden);
  });

  it('parses the contract shape that carries no checksum', () => {
    expect(parseArchiveBundle({ version: 5, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }))
      .toEqual({ version: 5, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] });
  });

  it('refuses a v4 fullData export', () => {
    expect(() => parseArchiveBundle({ kind: 'fullData', gonesDataVersion: 4, gonesAppVersion: '0.1.0', exportedAt: '2026-01-15T00:00:00.000Z', leagues: [], calendarEvents: [] }))
      .toThrow('legacyArchiveBundleVersion');
  });

  it('refuses a v4 single-league export', () => {
    expect(() => parseArchiveBundle({ kind: 'league', gonesDataVersion: 4, league: { id: 'l', name: 'L', status: 'active', tournaments: [] } }))
      .toThrow('legacyArchiveBundleVersion');
  });

  it('refuses the pre-Angular v1 shape', () => {
    expect(() => parseArchiveBundle({ version: 1, exportedAt: '2024-01-01', league: { id: 'l', name: 'L' } }))
      .toThrow('legacyArchiveBundleVersion');
  });

  it('refuses every data version from 1 to 4', () => {
    for (const version of [1, 2, 3, 4]) {
      expect(() => parseArchiveBundle({ version, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }))
        .toThrow('legacyArchiveBundleVersion');
    }
  });

  it('refuses a kind-tagged artifact even when it claims version 5', () => {
    expect(() => parseArchiveBundle({ version: 5, kind: 'fullData', leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }))
      .toThrow('legacyArchiveBundleVersion');
  });

  /**
   * Ruling R2. `scripts/dev-environments.mjs:167` builds a `POST /api/archive/restore-full` body that
   * also calls itself `version: 5`. It is a different schema and this parser refuses it on purpose;
   * pinning that here keeps the refusal deliberate rather than incidental.
   */
  it('refuses the restore-request wire shape that also calls itself version 5', () => {
    expect(() => parseArchiveBundle({ kind: 'fullArchive', version: 5, leagues: [], leagueSeasons: [], tournaments: [] }))
      .toThrow('unsupportedArchiveBundle');
  });

  it('refuses a version above 5', () => {
    expect(() => parseArchiveBundle({ version: 6, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }))
      .toThrow('unsupportedArchiveBundle');
  });

  it('refuses a non-object payload', () => {
    for (const payload of [null, 'text', 42, []]) {
      expect(() => parseArchiveBundle(payload)).toThrow('unsupportedArchiveBundle');
    }
  });

  it('refuses a bundle missing a collection', () => {
    const payload = goldenPayload();
    delete payload['leagueSeasons'];

    expect(() => parseArchiveBundle(payload)).toThrow('unsupportedArchiveBundle');
  });

  it('refuses a Tournament whose seasonId is undefined', () => {
    const payload = goldenPayload();
    delete rows(payload, 'tournaments')[0]['seasonId'];

    expect(() => parseArchiveBundle(payload)).toThrow('unsupportedArchiveBundle');
  });

  it('refuses a Tournament carrying a leagueId', () => {
    const payload = goldenPayload();
    rows(payload, 'tournaments')[0]['leagueId'] = 'archive-league-1';

    expect(() => parseArchiveBundle(payload)).toThrow('unsupportedArchiveBundle');
  });

  it('refuses a LeagueSeason with no leagueId', () => {
    const payload = goldenPayload();
    delete rows(payload, 'leagueSeasons')[0]['leagueId'];

    expect(() => parseArchiveBundle(payload)).toThrow('unsupportedArchiveBundle');
  });

  it('refuses an unknown status', () => {
    const payload = goldenPayload();
    rows(payload, 'leagueSeasons')[0]['status'] = 'finished';

    expect(() => parseArchiveBundle(payload)).toThrow('unsupportedArchiveBundle');
  });

  it('refuses more rows than a collection cap allows', () => {
    const template = goldenBundle().tournaments[0];
    const payload = goldenPayload();
    payload['tournaments'] = Array.from({ length: ARCHIVE_EXPORT_LIMITS.maxTournaments + 1 }, (_unused, index) => ({ ...template, id: `tournament-${index}` }));

    expect(() => parseArchiveBundle(payload)).toThrow('gonesImportTooManyRecords');
  });

  it('refuses a denylisted field anywhere in the payload', () => {
    const payload = goldenPayload();
    rows(rows(payload, 'tournaments')[0], 'playerArchetypes')[0]['email'] = 'a@b.c';

    expect(() => parseArchiveBundle(payload)).toThrow('deniedExportField:email');
  });

  it('verifies the checksum it attaches', async () => {
    expect(await verifyArchiveChecksum(await attachArchiveChecksum(goldenBundle()))).toBe(true);
  });

  it('rejects a tampered artifact', async () => {
    const artifact = await attachArchiveChecksum(goldenBundle());
    artifact.leagues[0].name = 'Tampered';

    expect(await verifyArchiveChecksum(artifact)).toBe(false);
  });

  it('accepts an artifact with no checksum', async () => {
    expect(await verifyArchiveChecksum(goldenBundle())).toBe(true);
  });

  it('names the export file with the ISO date', () => {
    expect(archiveBundleFilename(new Date('2026-08-22T18:00:00.000Z'))).toBe('2026-08-22 Gones Archive.json');
  });
});

describe('archive v5 golden fixtures', () => {
  it('reproduces the frozen v5 golden fixtures byte-for-byte', async () => {
    const bundleJson = stableJson(await attachArchiveChecksum(goldenBundle()));
    const legacyV1Json = stableJson(LEGACY_V1_FIXTURE);
    const legacyV4Json = stableJson(LEGACY_V4_FIXTURE);
    const manifestJson = stableJson({
      fixtureSet: 'gones-archive-export-parity',
      fixtureVersion: 5,
      source: {
        language: 'TypeScript',
        exporter: 'src/app/domain/archive-export-schemas.test.ts',
        sourceFiles: [
          'src/app/domain/archive-models.ts',
          'src/app/domain/archive-export-schemas.ts',
          'src/app/data/archive-import.service.ts'
        ],
        archiveDataVersion: ARCHIVE_DATA_VERSION
      },
      serialization: 'JSON.stringify(value, null, 2) + LF',
      bundleSha256: createHash('sha256').update(bundleJson).digest('hex'),
      caseCounts: {
        leagues: 2, leagueSeasons: 3, tournaments: 4,
        standaloneTournaments: 1, calendarEvents: 1, refusedBundles: 2
      }
    });

    if (process.env['UPDATE_ARCHIVE_FIXTURES'] === '1') {
      mkdirSync(fixtureDirectory, { recursive: true });
      writeFileSync(resolve(fixtureDirectory, 'bundle.json'), bundleJson);
      writeFileSync(resolve(fixtureDirectory, 'legacy-v1.json'), legacyV1Json);
      writeFileSync(resolve(fixtureDirectory, 'legacy-v4.json'), legacyV4Json);
      writeFileSync(resolve(fixtureDirectory, 'manifest.json'), manifestJson);
    }

    expect(readFileSync(resolve(fixtureDirectory, 'bundle.json'), 'utf8')).toBe(bundleJson);
    expect(readFileSync(resolve(fixtureDirectory, 'legacy-v1.json'), 'utf8')).toBe(legacyV1Json);
    expect(readFileSync(resolve(fixtureDirectory, 'legacy-v4.json'), 'utf8')).toBe(legacyV4Json);
    expect(readFileSync(resolve(fixtureDirectory, 'manifest.json'), 'utf8')).toBe(manifestJson);
  });
});
