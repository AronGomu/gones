import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createGonesData,
  createIdFactory,
  createLeague,
  createPlaceholderLeague,
  createTournament,
  isUnassignedLeagueName,
  normalizeLeague,
  normalizeLeagueNameKey,
  PLACEHOLDER_LEAGUE_ID
} from './models';
import { calculatePlayerStatistics } from './player-stats';
import { calculateLeagueResult, calculateTournamentResult } from './results';
import { importRoundEntries } from './round-import';
import { renamePlayerInLeague } from './rename-player';
import { validateRoundEntry } from './validation';
import { getTournamentWarnings } from './warnings';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/league-domain/v1');
const parityPath = resolve(fixtureDirectory, 'parity.json');
const manifestPath = resolve(fixtureDirectory, 'manifest.json');

function fixtureDocument() {
  const normalizationInput = {
    id: 'league-1',
    name: '  Été League  ',
    status: 'finished',
    tournaments: [{
      id: 'tournament-1',
      leagueId: '',
      name: '  Weekly Cup  ',
      tournamentDate: ' 2026-03-08 ',
      rounds: [{
        id: 'round-1',
        entries: [
          { kind: 'match', id: 'match-1', table: '', player1Name: ' Alice ', player2Name: 'BOB ', player1Score: '2', player2Score: -1, player1DeckArchetype: '  Red   Aggro ', player2DeckArchetype: 'No Archetype' },
          { kind: 'match', id: 'match-2', table: '4', player1Name: 'Null Score', player2Name: 'Missing Score', player1Score: null, player1DeckArchetype: '', player2DeckArchetype: '' },
          { kind: 'bye', id: 'bye-1', table: '', playerName: ' Carol ', deckArchetype: '  Blue   Control  ' },
          { kind: 'invalid', id: 'invalid-1', rawText: 'bad,row', table: '', player: ' Dana ', result: '???', opponent: ' Eve ', playerDecklist: ' raw ', opponentDecklist: ' raw2 ' }
        ]
      }],
      playerArchetypes: [
        { playerName: ' bob ', archetype: ' No Archetype ' },
        { playerName: 'Alice', archetype: '  Red   Aggro ' },
        { playerName: 'Alice', archetype: 'Ignored duplicate' },
        { playerName: '', archetype: 'Ignored' }
      ]
    }]
  };

  const validationEntries = [
    { kind: 'invalid', id: 'i1', rawText: 'x', table: '', player: '', result: '', opponent: '', playerDecklist: '', opponentDecklist: '' },
    { kind: 'bye', id: 'b1', table: '1', playerName: ' bye ', deckArchetype: '' },
    { kind: 'match', id: 'm1', table: '2', player1Name: 'Alice', player2Name: 'Alice', player1Score: 3, player2Score: -1, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'match', id: 'm2', table: '3', player1Name: 'Alice', player2Name: 'alice', player1Score: 1, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' }
  ] as const;

  const warningTournament = createTournament({
    id: 'warning-tournament', leagueId: 'warning-league', name: 'Warnings', tournamentDate: '2026-03-01',
    playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }],
    rounds: [
      { id: 'wr1', entries: [{ kind: 'match', id: 'wm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] },
      { id: 'wr2', entries: [
        { kind: 'match', id: 'wm2', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' },
        { kind: 'match', id: 'wm3', table: '2', player1Name: 'Alice', player2Name: 'Carol', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' }
      ] }
    ]
  });

  const resultTournament = createTournament({
    id: 'result-tournament', leagueId: 'result-league', name: 'Results', tournamentDate: '2026-02-02',
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
  });
  const resultLeague = createLeague({
    id: 'result-league', name: 'Result League', status: 'active', tournaments: [
      resultTournament,
      createTournament({ id: 'empty-tournament', leagueId: 'result-league', name: 'Empty', tournamentDate: '2026-03-03', rounds: [], playerArchetypes: [] })
    ]
  });

  const statsLeague = createLeague({
    id: 'stats-league', name: 'Stats', status: 'active', tournaments: [createTournament({
      id: 'stats-tournament', leagueId: 'stats-league', name: 'Stats Event', tournamentDate: '2026-01-01',
      rounds: [
        { id: 'sr1', entries: [
          { kind: 'match', id: 'sm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 0, player2Score: 2, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Ice' },
          { kind: 'match', id: 'sm2', table: '2', player1Name: 'Alice', player2Name: 'Carol', player1Score: 1, player2Score: 2, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Earth' }
        ] },
        { id: 'sr2', entries: [
          { kind: 'match', id: 'sm3', table: '1', player1Name: 'Bob', player2Name: 'Alice', player1Score: 0, player2Score: 2, player1DeckArchetype: 'Ice', player2DeckArchetype: 'Fire' },
          { kind: 'bye', id: 'sb1', table: '2', playerName: 'Alice', deckArchetype: 'Fire' }
        ] }
      ]
    })]
  });
  const otherStatsLeague = createLeague({
    id: 'other-league', name: 'Other', status: 'completed', tournaments: [createTournament({
      id: 'other-tournament', leagueId: 'other-league', name: 'Other Event', tournamentDate: '2025-01-01',
      rounds: [{ id: 'or1', entries: [{ kind: 'match', id: 'om1', table: '1', player1Name: 'Alice', player2Name: 'Zed', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' }] }]
    })]
  });
  const statsData = createGonesData({ leagues: [statsLeague, otherStatsLeague] });

  const renameLeague = createLeague({
    id: 'rename-league', name: 'Rename', status: 'active', tournaments: [createTournament({
      id: 'rename-tournament', leagueId: 'rename-league', name: 'Rename Event', tournamentDate: '2026-01-02',
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
    })]
  });

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
    sourceDataVersion: 4,
    normalization: [{ input: normalizationInput, expected: normalizeLeague(normalizationInput as never, { idFactory: createIdFactory('normalized') }) }],
    csvImports: [
      { input: { text: csv, idPrefix: 'csv' }, expected: importRoundEntries(csv, { idFactory: createIdFactory('csv') }) },
      { input: { text: semicolonCsv, idPrefix: 'semicolon' }, expected: importRoundEntries(semicolonCsv, { idFactory: createIdFactory('semicolon') }) }
    ],
    validations: validationEntries.map((input) => ({ input, expected: validateRoundEntry(input as never) })),
    warnings: [{ input: warningTournament, expected: getTournamentWarnings(warningTournament) }],
    tournamentResults: [{ input: resultTournament, expected: calculateTournamentResult(resultTournament) }],
    leagueResults: [{ input: resultLeague, expected: calculateLeagueResult(resultLeague) }],
    playerStatistics: [
      { input: { data: statsData, playerName: 'Alice', filters: {} }, expected: calculatePlayerStatistics(statsData, 'Alice') },
      { input: { data: statsData, playerName: 'Alice', filters: { leagueId: 'stats-league', opponentName: ' BO ' } }, expected: calculatePlayerStatistics(statsData, 'Alice', { leagueId: 'stats-league', opponentName: ' BO ' }) },
      { input: { data: statsData, playerName: 'Nobody', filters: { tournamentId: 'missing' } }, expected: calculatePlayerStatistics(statsData, 'Nobody', { tournamentId: 'missing' }) }
    ],
    renames: [{ input: { league: renameLeague, fromName: ' alice ', toName: 'Bob' }, expected: renamePlayerInLeague(renameLeague, ' alice ', 'Bob') }],
    placeholders: [{
      input: { id: PLACEHOLDER_LEAGUE_ID, name: 'Tournois non assignés', status: 'finished' },
      expected: {
        league: normalizeLeague({ id: PLACEHOLDER_LEAGUE_ID, name: 'Tournois non assignés', status: 'finished' } as never),
        created: createPlaceholderLeague(),
        nameKeys: ['  Été League  ', 'ÉTÉ LEAGUE', ' Tournois non assignés '].map(normalizeLeagueNameKey),
        unassigned: ['Unassigned Tournaments', ' Tournois non assignés ', 'Other'].map(isUnassignedLeagueName)
      }
    }]
  };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function manifest(parityJson: string, document: ReturnType<typeof fixtureDocument>) {
  return {
    fixtureSet: 'gones-league-domain-parity',
    fixtureVersion: 1,
    source: {
      language: 'TypeScript',
      exporter: 'src/app/domain/league-parity-fixtures.test.ts',
      sourceFiles: [
        'src/app/domain/models.ts',
        'src/app/domain/player-stats.ts',
        'src/app/domain/results.ts',
        'src/app/domain/round-import.ts',
        'src/app/domain/rename-player.ts',
        'src/app/domain/tournament-archetypes.ts',
        'src/app/domain/validation.ts',
        'src/app/domain/warnings.ts'
      ],
      sourceRevision: 'e930c8399ae3720049bc6e0169964c3d5c75c025',
      runtime: { node: 'v24.18.0', icu: '78.3', typescript: '5.9.3', vitest: '4.1.7' },
      sourceDataVersion: 4
    },
    serialization: 'JSON.stringify(value, null, 2) + LF',
    paritySha256: createHash('sha256').update(parityJson).digest('hex'),
    caseCounts: {
      normalization: document.normalization.length,
      csvImports: document.csvImports.length,
      validations: document.validations.length,
      warnings: document.warnings.length,
      tournamentResults: document.tournamentResults.length,
      leagueResults: document.leagueResults.length,
      playerStatistics: document.playerStatistics.length,
      renames: document.renames.length,
      placeholders: document.placeholders.length
    }
  };
}

describe('League parity fixture exporter', () => {
  it('reproduces frozen language-neutral fixtures byte-for-byte', () => {
    const document = fixtureDocument();
    const parityJson = stableJson(document);
    const manifestJson = stableJson(manifest(parityJson, document));

    if (process.env['UPDATE_LEAGUE_PARITY_FIXTURES'] === '1') {
      mkdirSync(fixtureDirectory, { recursive: true });
      writeFileSync(parityPath, parityJson);
      writeFileSync(manifestPath, manifestJson);
    }

    expect(readFileSync(parityPath, 'utf8')).toBe(parityJson);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestJson);
  });
});
