import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createArchiveTournament } from './archive-models';
import { createIdFactory } from './models';
import { calculateGlobalPlayerStatistics, calculatePlayerStatistics } from './player-stats';
import type { PlayerStatistics } from './player-stats';
import { calculateLeagueResult, calculateTournamentResult } from './results';
import { importRoundEntries } from './round-import';
import { renamePlayerInTournament } from './rename-player';
import { validateRoundEntry } from './validation';
import { getTournamentWarnings } from './warnings';

/**
 * The TypeScript half of the cross-stack domain parity corpus. It emits language-neutral fixtures
 * that `Gones.UnitTests.LeagueParityTests` replays through the C# domain, so a rule that drifts on one
 * side fails on the other instead of quietly disagreeing in production.
 *
 * Rebuilt on the three-tier shapes for the archive rebuild: the v1 corpus was emitted from the flat
 * `LeagueDocument`/`GonesData` shapes, which are retired. The `placeholders` class went with the
 * fixed `placeholder-league` row, and the League-document rename case became a Tournament rename —
 * both retired on the C# side too, so the two stacks still cover the same rules.
 *
 * The v1 `normalization` class has no successor: C# normalizes an archive document at the entity
 * boundary (`ArchiveTournament`) rather than through a `Normalize(JsonElement)` twin of
 * `normalizeArchiveTournament`, so there is nothing to replay it against. Every rule the corpus
 * exists for — rounds, entries, byes, standings, statistics and renames — is still covered.
 *
 * Regenerate with `UPDATE_ARCHIVE_PARITY_FIXTURES=1 npx vitest run src/app/domain/archive-parity-fixtures.test.ts`.
 */

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/archive-domain/v5/parity');
const parityPath = resolve(fixtureDirectory, 'parity.json');
const manifestPath = resolve(fixtureDirectory, 'manifest.json');

function fixtureDocument() {
  const validationEntries = [
    { kind: 'invalid', id: 'i1', rawText: 'x', table: '', player: '', result: '', opponent: '', playerDecklist: '', opponentDecklist: '' },
    { kind: 'bye', id: 'b1', table: '1', playerName: ' bye ', deckArchetype: '' },
    { kind: 'match', id: 'm1', table: '2', player1Name: 'Alice', player2Name: 'Alice', player1Score: 3, player2Score: -1, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'match', id: 'm2', table: '3', player1Name: 'Alice', player2Name: 'alice', player1Score: 1, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' }
  ] as const;

  const warningTournament = createArchiveTournament({
    id: 'warning-tournament', seasonId: 'warning-season', name: 'Warnings', tournamentDate: '2026-03-01',
    playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }],
    rounds: [
      { id: 'wr1', entries: [{ kind: 'match', id: 'wm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] },
      { id: 'wr2', entries: [
        { kind: 'match', id: 'wm2', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' },
        { kind: 'match', id: 'wm3', table: '2', player1Name: 'Alice', player2Name: 'Carol', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' }
      ] }
    ]
  } as never);

  const resultTournament = createArchiveTournament({
    id: 'result-tournament', seasonId: 'result-season', name: 'Results', tournamentDate: '2026-02-02',
    playerArchetypes: [
      { playerName: 'Alice', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' },
      { playerName: 'Carol', archetype: 'Earth' },
      { playerName: 'Dave', archetype: 'Air' }
    ],
    rounds: [
      { id: 'rr1', entries: [
        { kind: 'match', id: 'rm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Ice' },
        { kind: 'bye', id: 'rb1', table: '2', playerName: 'Carol', deckArchetype: 'Earth' }
      ] },
      { id: 'rr2', entries: [
        { kind: 'match', id: 'rm2', table: '1', player1Name: 'Alice', player2Name: 'Carol', player1Score: 1, player2Score: 1, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Earth' },
        { kind: 'match', id: 'rm3', table: '2', player1Name: 'Bob', player2Name: 'Dave', player1Score: 2, player2Score: 1, player1DeckArchetype: 'Ice', player2DeckArchetype: 'Air' }
      ] },
      { id: 'rr3', entries: [{ kind: 'invalid', id: 'ri1', rawText: 'bad', table: '', player: '', result: '', opponent: '', playerDecklist: '', opponentDecklist: '' }] }
    ]
  } as never);
  // The Season scope: the same standings pass over every Tournament of one LeagueSeason.
  const seasonTournaments = [
    resultTournament,
    createArchiveTournament({ id: 'empty-tournament', seasonId: 'result-season', name: 'Empty', tournamentDate: '2026-03-03', rounds: [], playerArchetypes: [] })
  ];

  const statsTournament = createArchiveTournament({
    id: 'stats-tournament', seasonId: 'stats-season', name: 'Stats Event', tournamentDate: '2026-01-01', status: 'completed',
    playerArchetypes: [
      { playerName: 'Alice', archetype: 'Alpha' },
      { playerName: 'Roster Only', archetype: 'Air' }
    ],
    rounds: [
      { id: 'sr1', entries: [
        { kind: 'match', id: 'sm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 0, player2Score: 2, player1DeckArchetype: 'Zoo', player2DeckArchetype: 'Ice' },
        { kind: 'match', id: 'sm2', table: '2', player1Name: 'Alice', player2Name: 'Carol', player1Score: 1, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: 'Earth' },
        { kind: 'match', id: 'sm3', table: '3', player1Name: 'Alice', player2Name: 'alice', player1Score: 1, player2Score: 1, player1DeckArchetype: 'Beta', player2DeckArchetype: 'beta' }
      ] },
      { id: 'sr2', entries: [
        { kind: 'match', id: 'sm4', table: '1', player1Name: 'Bob', player2Name: 'Alice', player1Score: 0, player2Score: 2, player1DeckArchetype: 'Ice', player2DeckArchetype: 'Gamma' },
        { kind: 'match', id: 'sm5', table: '2', player1Name: 'Carol', player2Name: 'Alice', player1Score: 0, player2Score: 2, player1DeckArchetype: 'Earth', player2DeckArchetype: 'Delta' },
        { kind: 'bye', id: 'sb1', table: '3', playerName: 'Alice', deckArchetype: 'Ignored' },
        { kind: 'bye', id: 'sb2', table: '4', playerName: 'Bye Only', deckArchetype: 'Earth' }
      ] }
    ]
  } as never);
  // A standalone Tournament (`seasonId: null`) contributes to the global scope and to no Season.
  const otherStatsTournament = createArchiveTournament({
    id: 'other-tournament', seasonId: null, name: 'Other Event', tournamentDate: '2025-01-01', status: 'completed',
    rounds: [{ id: 'or1', entries: [{ kind: 'match', id: 'om1', table: '1', player1Name: 'Alice', player2Name: 'Zed', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' }] }]
  } as never);
  const statsTournaments = [statsTournament, otherStatsTournament];

  const renameTournament = createArchiveTournament({
    id: 'rename-tournament', seasonId: 'rename-season', name: 'Rename Event', tournamentDate: '2026-01-02',
    playerArchetypes: [
      { playerName: 'Alice', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' },
      { playerName: 'Carol', archetype: '' }
    ],
    rounds: [{ id: 'rename-round', entries: [
      { kind: 'match', id: 'rename-match', table: '1', player1Name: 'ALICE', player2Name: 'Bob', player1Score: 2, player2Score: 1, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Ice' },
      { kind: 'bye', id: 'rename-bye', table: '2', playerName: 'Alice', deckArchetype: 'Fire' },
      { kind: 'invalid', id: 'rename-invalid', rawText: 'x', table: '3', player: 'alice', result: '?', opponent: 'Carol', playerDecklist: '', opponentDecklist: '' }
    ] }]
  } as never);

  const csv = [
    'Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist',
    '7,"Alice, Jr",Won 2-1,Bob," Red, Aggro ",Ice',
    '8,Carol,Drawn 1-1,Dana,Earth,Air',
    '9,Eve,Won 0-2,Frank,Fire,Water',
    'malformed,row'
  ].join('\n');
  const semicolonCsv = '3;Élodie;Lost 0-2;Zoë;"Blue ""Tempo""";Green';

  return {
    fixtureVersion: 1,
    sourceDataVersion: 5,
    csvImports: [
      { input: { text: csv, idPrefix: 'csv' }, expected: importRoundEntries(csv, { idFactory: createIdFactory('csv') }) },
      { input: { text: semicolonCsv, idPrefix: 'semicolon' }, expected: importRoundEntries(semicolonCsv, { idFactory: createIdFactory('semicolon') }) }
    ],
    validations: validationEntries.map((input) => ({ input, expected: validateRoundEntry(input as never) })),
    warnings: [{ input: warningTournament, expected: getTournamentWarnings(warningTournament) }],
    tournamentResults: [{ input: resultTournament, expected: calculateTournamentResult(resultTournament) }],
    leagueSeasonResults: [{ input: seasonTournaments, expected: calculateLeagueResult(seasonTournaments) }],
    playerStatistics: [
      { input: { tournaments: statsTournaments, playerName: 'Alice', filters: {} }, expected: countsOnly(calculatePlayerStatistics(statsTournaments, 'Alice')) },
      { input: { tournaments: statsTournaments, playerName: 'Alice', filters: { seasonId: 'stats-season', opponentName: ' BO ' } }, expected: countsOnly(calculatePlayerStatistics(statsTournaments, 'Alice', { seasonId: 'stats-season', opponentName: ' BO ' })) },
      { input: { tournaments: statsTournaments, playerName: 'Nobody', filters: { tournamentId: 'missing' } }, expected: countsOnly(calculatePlayerStatistics(statsTournaments, 'Nobody', { tournamentId: 'missing' })) }
    ],
    globalPlayerStatistics: [{ input: statsTournaments, expected: calculateGlobalPlayerStatistics(statsTournaments) }],
    renames: [{ input: { tournament: renameTournament, fromName: ' alice ', toName: 'Bob' }, expected: renamePlayerInTournament(renameTournament, ' alice ', 'Bob') }]
  };
}

/**
 * Everything but `matches`. A match carries its context object, and the two stacks disagree on that
 * shape by design — C# `PlayerMatch` still names a carrier `League`, TypeScript names the Archive
 * Tournament. The numbers the rule exists to produce — counts, winrates, nemesis, rival, most played
 * archetype — are identical and are what this class asserts.
 */
function countsOnly(statistics: PlayerStatistics): Omit<PlayerStatistics, 'matches'> {
  const { matches: _matches, ...counts } = statistics;
  return counts;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function manifest(parityJson: string, document: ReturnType<typeof fixtureDocument>) {
  return {
    fixtureSet: 'gones-archive-domain-parity',
    fixtureVersion: 1,
    source: {
      language: 'TypeScript',
      exporter: 'src/app/domain/archive-parity-fixtures.test.ts',
      sourceFiles: [
        'src/app/domain/archive-models.ts',
        'src/app/domain/models.ts',
        'src/app/domain/player-stats.ts',
        'src/app/domain/results.ts',
        'src/app/domain/round-import.ts',
        'src/app/domain/rename-player.ts',
        'src/app/domain/tournament-archetypes.ts',
        'src/app/domain/validation.ts',
        'src/app/domain/warnings.ts'
      ],
      sourceDataVersion: 5
    },
    serialization: 'JSON.stringify(value, null, 2) + LF',
    paritySha256: createHash('sha256').update(parityJson).digest('hex'),
    caseCounts: {
      csvImports: document.csvImports.length,
      validations: document.validations.length,
      warnings: document.warnings.length,
      tournamentResults: document.tournamentResults.length,
      leagueSeasonResults: document.leagueSeasonResults.length,
      playerStatistics: document.playerStatistics.length,
      globalPlayerStatistics: document.globalPlayerStatistics.length,
      renames: document.renames.length
    }
  };
}

describe('Archive parity fixture exporter', () => {
  it('reproduces frozen language-neutral fixtures byte-for-byte', () => {
    const document = fixtureDocument();
    const parityJson = stableJson(document);
    const manifestJson = stableJson(manifest(parityJson, document));

    if (process.env['UPDATE_ARCHIVE_PARITY_FIXTURES'] === '1') {
      mkdirSync(fixtureDirectory, { recursive: true });
      writeFileSync(parityPath, parityJson);
      writeFileSync(manifestPath, manifestJson);
    }

    expect(readFileSync(parityPath, 'utf8')).toBe(parityJson);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestJson);
  });
});
