import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIdFactory } from './models';
import {
  activeLivePlayers,
  autoLiveSwissRoundCount,
  calculateLiveStandings,
  calculateLiveStandingsThroughRound,
  cancelCurrentSwissRound,
  canStartLiveTournament,
  createLiveTournament,
  createLiveTournamentPlayer,
  currentRoundComplete,
  expectedLiveSwissRoundCount,
  finalizeLiveTournament,
  generateNextSwissRound,
  liveMatchScoreIssue,
  liveTournamentFinished,
  LiveTournamentDocument,
  regenerateCurrentSwissRound,
  restoreLiveTournamentCheckpoint,
  seededShuffle,
  unpaidActivePlayers,
  updateLiveRoundEntryResult,
  validateCurrentSwissRound
} from './live-tournament';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/live-domain/v1');
const parityPath = resolve(fixtureDirectory, 'parity.json');
const manifestPath = resolve(fixtureDirectory, 'manifest.json');

const FIXED_NOW = '2026-08-05T12:00:00.000Z';

let uuidCounter = 0;
function resetUuidCounter(): void {
  uuidCounter = 0;
}

function todayDateInputValue(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fixtureDocument() {
  const today = todayDateInputValue();

  const registrationInputs = [
    { id: 'player-1', name: '  Alice  ', paid: 'yes', dropped: 0, initialWins: '2', initialDraws: null, initialLosses: -3, archetype: '  Red  Aggro  ' },
    { name: '' },
    { id: 'player-3', name: ' Bob ', paid: true, dropped: true, initialWins: 2, initialDraws: '1', initialLosses: '0', archetype: 'no archetype' }
  ];
  resetUuidCounter();
  const registrations = registrationInputs.map((input) => ({ input, expected: createLiveTournamentPlayer(input as never) }));

  const messyNormalizationInput = {
    id: 'live-1',
    name: '  Friday   Live  ',
    leagueId: null,
    tournamentDate: '',
    roundCount: '4',
    customRoundCount: 1,
    paidTrackingEnabled: false,
    pairingSeed: '77',
    firstRoundPlayerOrder: ['p1', ' p1 ', '', 'p2', 'p1'],
    stage: 'round',
    currentRoundNumber: '1',
    players: [
      { id: 'p1', name: 'alice', paid: true },
      { id: 'p2', name: ' Alice ', initialWins: '1' },
      { id: 'p3', name: 'ALICE', archetype: ' Blue  Control ' },
      { id: 'p4', name: '   ' }
    ],
    rounds: [{
      id: 'r1',
      roundNumber: 0,
      validated: 'yes',
      entries: [
        { entry: { kind: 'match', id: 'm1', table: '1', player1Name: ' alice ', player2Name: 'Alice (2)', player1Score: '2', player2Score: -1, player1DeckArchetype: ' Red  Aggro ', player2DeckArchetype: 'No Archetype' } },
        { entry: { kind: 'match', id: 'm2', table: '2', player1Name: 'ALICE', player2Name: 'Ghost' }, resultEntered: true },
        { entry: { kind: 'bye', id: 'b1', table: '3', playerName: ' alice ', deckArchetype: '  Blue   Control ' }, resultEntered: false },
        { entry: { kind: 'invalid', id: 'i1', rawText: 'bad,row', table: '4', player: ' alice ', result: '???', opponent: ' Ghost ', playerDecklist: ' raw ', opponentDecklist: ' raw2 ' } },
        { entry: null },
        { entry: { kind: 'weird', id: 'w1' } },
        {}
      ]
    }, {
      entries: 'not-an-array'
    }],
    checkpoints: [{
      id: 'c1',
      label: '',
      createdAt: '',
      stage: 'registration',
      currentRoundNumber: '1',
      roundCount: -2,
      paidTrackingEnabled: false,
      players: [{ id: 'cp1', name: ' alice ' }],
      rounds: [{ id: 'cr1', entries: [{ entry: { kind: 'bye', id: 'cb1', table: '1', playerName: 'alice', deckArchetype: '' } }] }]
    }, {
      id: 'c2',
      stage: 'standings',
      currentRoundNumber: 1,
      roundCount: 1
    }],
    documentVersion: 0,
    createdAt: '2026-08-01T08:00:00.000Z'
  };
  const overflowingCheckpoints = {
    id: 'live-overflow',
    name: 'Overflow',
    tournamentDate: '2026-08-05',
    checkpoints: Array.from({ length: 82 }, (_, index) => ({
      id: `c-${index + 1}`,
      label: `Checkpoint ${index + 1}`,
      createdAt: '2026-08-01T00:00:00.000Z',
      stage: 'standings',
      currentRoundNumber: 1,
      roundCount: 1,
      players: [],
      rounds: []
    })),
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-02T08:00:00.000Z'
  };
  const normalizationCases = [messyNormalizationInput, overflowingCheckpoints, { stage: 'completed', players: [] }];
  const normalizations = normalizationCases.map((input) => {
    resetUuidCounter();
    return { input, expected: createLiveTournament(input as never) };
  });

  const shuffles = [
    { items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], seed: 1 },
    { items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], seed: 424242 },
    { items: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9', 'p-10'], seed: 4294967295 },
    { items: [], seed: 5 },
    { items: ['x'], seed: 0 }
  ].map((input) => ({ input, expected: seededShuffle(input.items, input.seed) }));

  // Flow scenario: five players through launch, scoring, validation, next round.
  const flowIds = createIdFactory('flow');
  const flowPlayers = ['Alice', 'Bob', 'Charlie', 'Dana', 'Eve'].map((name, index) =>
    createLiveTournamentPlayer({ name, paid: index !== 4 }, { idFactory: flowIds }));
  resetUuidCounter();
  const registration = createLiveTournament({
    id: 'flow-live',
    name: 'Flow Night',
    leagueId: 'league-flow',
    tournamentDate: '2026-08-05',
    roundCount: 3,
    players: flowPlayers
  }, { idFactory: flowIds });

  const round1 = generateNextSwissRound(registration, { idFactory: createIdFactory('gen1'), randomSeed: () => 424242 });
  const round1Matches = round1.rounds[0].entries.filter((item) => item.entry.kind === 'match');
  const scoredOnce = updateLiveRoundEntryResult(round1, round1.rounds[0].id, round1Matches[0].entry.id, { player1Score: 2, player2Score: 1 });
  const scoredTwice = updateLiveRoundEntryResult(scoredOnce, round1.rounds[0].id, round1Matches[1].entry.id, { player1Score: 2, player2Score: 0 });
  resetUuidCounter();
  const standings1 = validateCurrentSwissRound(scoredTwice);
  const round2 = generateNextSwissRound(standings1, { idFactory: createIdFactory('gen2') });
  const round2Matches = round2.rounds.at(-1)!.entries.filter((item) => item.entry.kind === 'match');
  const round2Scored = round2Matches.reduce(
    (doc, item) => updateLiveRoundEntryResult(doc, round2.rounds.at(-1)!.id, item.entry.id, { player1Score: 0, player2Score: 2 }),
    round2);
  resetUuidCounter();
  const standings2 = validateCurrentSwissRound(round2Scored);

  // Relaunch scenarios exercising locked seed/order.
  const relaunchIds = createIdFactory('base');
  const [anna, bruno, cora] = ['Anna', 'Bruno', 'Cora'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: relaunchIds }));
  resetUuidCounter();
  const lockedOdd = createLiveTournament({
    id: 'relaunch-live',
    name: 'Relaunch',
    tournamentDate: '2026-08-05',
    roundCount: 3,
    pairingSeed: 7,
    firstRoundPlayerOrder: [anna.id, bruno.id, cora.id],
    players: [anna, bruno, cora]
  }, { idFactory: relaunchIds });
  const dora = createLiveTournamentPlayer({ id: 'base-new-1', name: 'Dora' });
  const elio = createLiveTournamentPlayer({ id: 'base-new-2', name: 'Elio' });
  resetUuidCounter();
  const lockedEven = createLiveTournament({
    ...lockedOdd,
    id: 'relaunch-even',
    pairingSeed: 9,
    firstRoundPlayerOrder: [anna.id, bruno.id],
    players: [anna, bruno]
  });
  const oneNewOdd = { ...lockedOdd, players: [...lockedOdd.players, dora] };
  const oneNewEven = { ...lockedEven, players: [...lockedEven.players, dora] };
  const twoNew = { ...lockedOdd, players: [...lockedOdd.players, dora, elio] };

  const roundGenerations = [
    { tournament: registration, idPrefix: 'gen1', randomSeed: 424242 },
    { tournament: standings1, idPrefix: 'gen2', randomSeed: null },
    { tournament: lockedOdd, idPrefix: 'relaunch-same', randomSeed: 999999 },
    { tournament: oneNewOdd, idPrefix: 'relaunch-one-odd', randomSeed: null },
    { tournament: oneNewEven, idPrefix: 'relaunch-one-even', randomSeed: null },
    { tournament: twoNew, idPrefix: 'relaunch-two', randomSeed: null },
    { tournament: standings2, idPrefix: 'gen-done', randomSeed: null }
  ].map((input) => ({
    input,
    expected: generateNextSwissRound(input.tournament, {
      idFactory: createIdFactory(input.idPrefix),
      ...(input.randomSeed === null ? {} : { randomSeed: () => input.randomSeed as number })
    })
  }));

  const roundRegenerations = [
    { tournament: round1, idPrefix: 'regen1', randomSeed: 909090 },
    { tournament: round2, idPrefix: 'regen2', randomSeed: null },
    { tournament: standings1, idPrefix: 'regen-noop', randomSeed: null }
  ].map((input) => ({
    input,
    expected: regenerateCurrentSwissRound(input.tournament, {
      idFactory: createIdFactory(input.idPrefix),
      ...(input.randomSeed === null ? {} : { randomSeed: () => input.randomSeed as number })
    })
  }));

  const roundCancellations = [round1, round2, standings1].map((tournament) => ({
    input: { tournament },
    expected: cancelCurrentSwissRound(tournament)
  }));

  const roundValidations = [scoredTwice, round1, round2Scored, standings1].map((tournament) => {
    resetUuidCounter();
    return { input: { tournament }, expected: validateCurrentSwissRound(tournament) };
  });

  const scoreUpdates = [
    { tournament: round1, roundId: round1.rounds[0].id, entryId: round1Matches[0].entry.id, player1Score: 2, player2Score: 1 },
    { tournament: round1, roundId: round1.rounds[0].id, entryId: round1Matches[1].entry.id, player1Score: 7, player2Score: 2.5 },
    { tournament: round1, roundId: 'missing-round', entryId: round1Matches[0].entry.id, player1Score: 1, player2Score: 1 }
  ].map((input) => ({
    input,
    expected: updateLiveRoundEntryResult(input.tournament, input.roundId, input.entryId, { player1Score: input.player1Score, player2Score: input.player2Score })
  }));

  const scoreIssueEntries = [
    { kind: 'match', id: 's1', table: '1', player1Name: 'A', player2Name: 'B', player1Score: 2, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'match', id: 's2', table: '1', player1Name: 'A', player2Name: 'B', player1Score: 1.5, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'match', id: 's3', table: '1', player1Name: 'A', player2Name: 'B', player1Score: -1, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'match', id: 's4', table: '1', player1Name: 'A', player2Name: 'B', player1Score: 3, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'match', id: 's5', table: '1', player1Name: 'A', player2Name: 'B', player1Score: 2, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
    { kind: 'bye', id: 's6', table: '1', playerName: 'A', deckArchetype: '' }
  ] as const;
  const scoreIssues = scoreIssueEntries.map((input) => ({ input, expected: liveMatchScoreIssue(input as never) }));

  const droppedRoster = createLiveTournament({
    ...standings2,
    id: 'dropped-live',
    players: standings2.players.map((player) => player.name === 'Eve' ? { ...player, dropped: true } : player)
  });
  const lateJoin = createLiveTournament({
    id: 'late-live',
    name: 'Late Join',
    tournamentDate: '2026-08-05',
    players: [
      createLiveTournamentPlayer({ id: 'late-1', name: 'Late Player', initialWins: 1, initialDraws: 1, initialLosses: 1 }),
      createLiveTournamentPlayer({ id: 'late-2', name: 'Fresh Player' }),
      createLiveTournamentPlayer({ id: 'late-3', name: '' })
    ]
  });
  const standingsCases = [
    { tournament: standings1, throughRound: null },
    { tournament: standings2, throughRound: null },
    { tournament: standings2, throughRound: 1 },
    { tournament: standings2, throughRound: 2 },
    { tournament: droppedRoster, throughRound: null },
    { tournament: lateJoin, throughRound: null }
  ];
  const standings = standingsCases.map((input) => ({
    input,
    expected: input.throughRound === null
      ? calculateLiveStandings(input.tournament)
      : calculateLiveStandingsThroughRound(input.tournament, input.throughRound)
  }));

  const completedDoc = createLiveTournament({ ...standings2, id: 'completed-live', stage: 'completed', finalizedTournamentId: 'result-1' });
  const restoreCases = [
    { tournament: standings2, checkpointId: standings2.checkpoints[0].id },
    { tournament: standings2, checkpointId: standings2.checkpoints.at(-1)!.id },
    { tournament: standings2, checkpointId: 'missing-checkpoint' },
    { tournament: completedDoc, checkpointId: completedDoc.checkpoints[0]?.id ?? 'missing-checkpoint' }
  ];
  const restores = restoreCases.map((input) => ({
    input,
    expected: restoreLiveTournamentCheckpoint(input.tournament, input.checkpointId)
  }));

  const finalizeInputs = [
    { tournament: standings2, idPrefix: 'final1' },
    { tournament: completedDoc, idPrefix: 'final2' },
    { tournament: round2, idPrefix: 'final3' }
  ];
  const completions = finalizeInputs.map((input) => ({
    input,
    expected: finalizeLiveTournament(input.tournament, { idFactory: createIdFactory(input.idPrefix) })
  }));

  const roundCountRules = [0, 1, 2, 3, 4, 15, 16, 17, 33, 64].map((input) => ({ input, expected: expectedLiveSwissRoundCount(input) }));

  const stateRuleDocs: [string, LiveTournamentDocument][] = [
    ['registration', registration],
    ['round1', round1],
    ['standings1', standings1],
    ['standings2', standings2],
    ['completed', completedDoc],
    ['lateJoin', lateJoin]
  ];
  const stateRules = stateRuleDocs.map(([label, tournament]) => ({
    input: { label, tournament },
    expected: {
      canStart: canStartLiveTournament(tournament),
      finished: liveTournamentFinished(tournament),
      autoRoundCount: autoLiveSwissRoundCount(tournament),
      activePlayerIds: activeLivePlayers(tournament).map((player) => player.id),
      unpaidActivePlayerIds: unpaidActivePlayers(tournament).map((player) => player.id),
      currentRoundComplete: currentRoundComplete(tournament)
    }
  }));

  return {
    fixtureVersion: 1,
    clock: { nowIso: FIXED_NOW, today },
    registrations,
    normalizations,
    shuffles,
    roundGenerations,
    roundRegenerations,
    roundCancellations,
    roundValidations,
    scoreUpdates,
    scoreIssues,
    standings,
    restores,
    completions,
    roundCountRules,
    stateRules
  };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function manifest(parityJson: string, document: ReturnType<typeof fixtureDocument>) {
  const caseCounts = Object.fromEntries(
    Object.entries(document)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as unknown[]).length])
  );
  return {
    fixtureSet: 'gones-live-domain-parity',
    fixtureVersion: 1,
    source: {
      language: 'TypeScript',
      exporter: 'src/app/domain/live-parity-fixtures.test.ts',
      sourceFiles: [
        'src/app/domain/live-tournament.ts',
        'src/app/domain/models.ts'
      ],
      sourceRevision: 'e68eb1103470e30f5b826d668a56cee14ad4be5c',
      runtime: { node: 'v24.18.0', icu: '78.3', typescript: '5.9.3', vitest: '4.1.7' },
      clock: document.clock
    },
    serialization: 'JSON.stringify(value, null, 2) + LF',
    paritySha256: createHash('sha256').update(parityJson).digest('hex'),
    caseCounts
  };
}

describe('Live parity fixture exporter', () => {
  beforeAll(() => {
    vi.useFakeTimers({ now: new Date(FIXED_NOW) });
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint32Array) => realCrypto.getRandomValues(array),
      randomUUID: () => `fixed-uuid-${++uuidCounter}`
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reproduces frozen language-neutral fixtures byte-for-byte', () => {
    const document = fixtureDocument();
    const parityJson = stableJson(document);
    const manifestJson = stableJson(manifest(parityJson, document));

    if (process.env['UPDATE_LIVE_PARITY_FIXTURES'] === '1') {
      mkdirSync(fixtureDirectory, { recursive: true });
      writeFileSync(parityPath, parityJson);
      writeFileSync(manifestPath, manifestJson);
    }

    expect(readFileSync(parityPath, 'utf8')).toBe(parityJson);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestJson);
  });
});
