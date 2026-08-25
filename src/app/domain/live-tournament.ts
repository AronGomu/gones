import { createByeRoundEntry, createMatchRoundEntry, createRound, createRoundEntry, defaultIdFactory, IdFactory, MatchRoundEntry, PlayerArchetypeDocument, RoundEntry, trimPlayerName } from './models';
import { createArchiveTournament } from './archive-models';
import type { ArchiveTournamentDocument } from './archive-models';

export type LiveTournamentStage = 'registration' | 'round' | 'standings' | 'completed';
export type LiveTournamentType = 'swiss';

export interface LiveTournamentPlayerDocument {
  id: string;
  name: string;
  paid: boolean;
  dropped: boolean;
  initialWins: number;
  initialDraws: number;
  initialLosses: number;
  archetype: string;
}

export interface LiveTournamentRoundEntryDocument {
  entry: RoundEntry;
  resultEntered: boolean;
}

export interface LiveTournamentRoundDocument {
  id: string;
  roundNumber: number;
  entries: LiveTournamentRoundEntryDocument[];
  validated: boolean;
}

export interface LiveTournamentCheckpointDocument {
  id: string;
  label: string;
  createdAt: string;
  stage: Extract<LiveTournamentStage, 'round' | 'standings'>;
  currentRoundNumber: number;
  roundCount: number;
  paidTrackingEnabled: boolean;
  players: LiveTournamentPlayerDocument[];
  rounds: LiveTournamentRoundDocument[];
}

export interface LiveTournamentDocument {
  id: string;
  name: string;
  leagueId: string;
  tournamentDate: string;
  type: LiveTournamentType;
  roundCount: number;
  customRoundCount: boolean;
  paidTrackingEnabled: boolean;
  /** Seed for first-round shuffle. Kept when round 1 is canceled so re-launch can reuse it. */
  pairingSeed: number;
  /** Player ids in first-round pairing order (pairs 0-1, 2-3, …; last alone = bye). Kept on cancel. */
  firstRoundPlayerOrder: string[];
  stage: LiveTournamentStage;
  currentRoundNumber: number;
  players: LiveTournamentPlayerDocument[];
  rounds: LiveTournamentRoundDocument[];
  checkpoints: LiveTournamentCheckpointDocument[];
  finalizedTournamentId?: string;
  documentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LiveStandingRow {
  rank: number;
  playerId: string;
  playerName: string;
  paid: boolean;
  dropped: boolean;
  points: number;
  matchWins: number;
  matchDraws: number;
  matchLosses: number;
  byes: number;
  playedMatchCount: number;
  matchAssignmentCount: number;
  gameWins: number;
  gameLosses: number;
  gameWinPercentage: number;
  opponentsMatchWinPercentage: number;
  opponentsGameWinPercentage: number;
}

type MutableLiveStandingRecord = Omit<LiveStandingRow, 'rank' | 'gameWinPercentage' | 'opponentsMatchWinPercentage' | 'opponentsGameWinPercentage'>;

export function createLiveTournament(
  { id, name = 'Live Tournament', leagueId = '', tournamentDate = todayDateInputValue(), type = 'swiss', roundCount = 3, customRoundCount = false, paidTrackingEnabled = true, pairingSeed = 0, firstRoundPlayerOrder = [], stage = 'registration', currentRoundNumber = 0, players = [], rounds = [], checkpoints = [], finalizedTournamentId, documentVersion = 1, createdAt = new Date().toISOString(), updatedAt = createdAt }: Partial<LiveTournamentDocument> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): LiveTournamentDocument {
  return {
    id: id ?? idFactory(),
    name: String(name || 'Live Tournament').trim() || 'Live Tournament',
    leagueId: String(leagueId ?? ''),
    tournamentDate: String(tournamentDate || todayDateInputValue()),
    type,
    roundCount: Math.max(0, toNonNegativeInteger(roundCount)),
    customRoundCount: Boolean(customRoundCount),
    paidTrackingEnabled: paidTrackingEnabled !== false,
    pairingSeed: toNonNegativeInteger(pairingSeed),
    firstRoundPlayerOrder: normalizePlayerIdList(firstRoundPlayerOrder),
    stage,
    currentRoundNumber: toNonNegativeInteger(currentRoundNumber),
    players: normalizeLivePlayers(players, { idFactory }),
    rounds: rounds.map((round, index) => normalizeLiveRound(round, index + 1, { idFactory })),
    checkpoints: checkpoints.map((checkpoint) => normalizeLiveCheckpoint(checkpoint, { idFactory })).slice(-80),
    finalizedTournamentId,
    documentVersion: Math.max(1, toNonNegativeInteger(documentVersion) || 1),
    createdAt,
    updatedAt
  };
}

export function createLiveTournamentPlayer(
  { id, name = '', paid = false, dropped = false, initialWins = 0, initialDraws = 0, initialLosses = 0, archetype = '' }: Partial<LiveTournamentPlayerDocument> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): LiveTournamentPlayerDocument {
  return {
    id: id ?? idFactory(),
    name: trimPlayerName(name),
    paid: Boolean(paid),
    dropped: Boolean(dropped),
    initialWins: toNonNegativeInteger(initialWins),
    initialDraws: toNonNegativeInteger(initialDraws),
    initialLosses: toNonNegativeInteger(initialLosses),
    archetype: String(archetype ?? '').trim()
  };
}

export function normalizeLiveTournament(source: Partial<LiveTournamentDocument>): LiveTournamentDocument {
  return createLiveTournament(source);
}

export function calculateLiveStandingsThroughRound(tournament: LiveTournamentDocument, roundNumber: number): LiveStandingRow[] {
  return calculateLiveStandings({
    ...tournament,
    rounds: tournament.rounds.filter((round) => round.validated && round.roundNumber <= roundNumber)
  });
}

export function restoreLiveTournamentCheckpoint(tournament: LiveTournamentDocument, checkpointId: string): LiveTournamentDocument {
  const checkpoint = tournament.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint || tournament.stage === 'completed') return tournament;
  const checkpointIndex = tournament.checkpoints.findIndex((item) => item.id === checkpoint.id);
  return touch({
    ...tournament,
    stage: checkpoint.stage,
    currentRoundNumber: checkpoint.currentRoundNumber,
    roundCount: checkpoint.roundCount,
    paidTrackingEnabled: checkpoint.paidTrackingEnabled,
    players: checkpoint.players.map((player) => createLiveTournamentPlayer(player)),
    rounds: checkpoint.rounds.map((round, index) => normalizeLiveRound(round, index + 1, { idFactory: defaultIdFactory })),
    checkpoints: checkpointIndex === -1 ? tournament.checkpoints : tournament.checkpoints.slice(0, checkpointIndex + 1)
  });
}

export function activeLivePlayers(tournament: LiveTournamentDocument): LiveTournamentPlayerDocument[] {
  return tournament.players.filter((player) => trimPlayerName(player.name) && !player.dropped);
}

export function unpaidActivePlayers(tournament: LiveTournamentDocument): LiveTournamentPlayerDocument[] {
  if (!tournament.paidTrackingEnabled) return [];
  return activeLivePlayers(tournament).filter((player) => !player.paid);
}

export function expectedLiveSwissRoundCount(playerCount: number): number {
  if (playerCount < 2) return 0;
  if (playerCount === 2) return 1;
  if (playerCount <= 15) return 3;
  return Math.ceil(Math.log2(playerCount));
}

export function autoLiveSwissRoundCount(tournament: LiveTournamentDocument): number {
  return expectedLiveSwissRoundCount(activeLivePlayers(tournament).length);
}

export function canStartLiveTournament(tournament: LiveTournamentDocument): boolean {
  return activeLivePlayers(tournament).length >= 2 && tournament.roundCount > 0 && tournament.stage === 'registration';
}

export function currentLiveRound(tournament: LiveTournamentDocument): LiveTournamentRoundDocument | null {
  return tournament.rounds.find((round) => round.roundNumber === tournament.currentRoundNumber) ?? null;
}

export function currentRoundComplete(tournament: LiveTournamentDocument): boolean {
  const round = currentLiveRound(tournament);
  if (!round || !round.entries.length) return false;
  return round.entries.every((entry) => entry.entry.kind === 'bye' || liveMatchScoreIssue(entry.entry) === null);
}

export function liveMatchScoreIssue(entry: RoundEntry): string | null {
  if (entry.kind !== 'match') return null;
  if (!Number.isInteger(entry.player1Score) || !Number.isInteger(entry.player2Score)) return 'Scores must be whole numbers.';
  if (entry.player1Score < 0 || entry.player2Score < 0) return 'Scores cannot be negative.';
  if (entry.player1Score > 2 || entry.player2Score > 2) return 'Scores cannot be over 2 victories.';
  if (entry.player1Score === 2 && entry.player2Score === 2) return 'Only one player can reach 2 victories.';
  return null;
}

export function calculateLiveStandings(tournament: LiveTournamentDocument): LiveStandingRow[] {
  const records = new Map<string, MutableLiveStandingRecord>();
  const opponentIdsByPlayer = new Map<string, string[]>();
  for (const player of tournament.players) {
    const name = trimPlayerName(player.name);
    if (!name) continue;
    records.set(player.id, {
      playerId: player.id,
      playerName: name,
      paid: player.paid,
      dropped: player.dropped,
      points: player.initialWins * 3 + player.initialDraws,
      matchWins: player.initialWins,
      matchDraws: player.initialDraws,
      matchLosses: player.initialLosses,
      byes: 0,
      playedMatchCount: player.initialWins + player.initialDraws + player.initialLosses,
      matchAssignmentCount: player.initialWins + player.initialDraws + player.initialLosses,
      gameWins: 0,
      gameLosses: 0
    });
  }

  for (const round of tournament.rounds.filter((item) => item.validated)) {
    for (const item of round.entries) {
      const entry = item.entry;
      if (entry.kind === 'bye') {
        const player = findPlayerByName(tournament, entry.playerName);
        const record = player ? records.get(player.id) : null;
        if (record) { record.matchWins += 1; record.byes += 1; record.points += 3; record.matchAssignmentCount += 1; }
        continue;
      }
      if (entry.kind !== 'match') continue;
      const player1 = findPlayerByName(tournament, entry.player1Name);
      const player2 = findPlayerByName(tournament, entry.player2Name);
      const record1 = player1 ? records.get(player1.id) : null;
      const record2 = player2 ? records.get(player2.id) : null;
      if (!player1 || !player2 || !record1 || !record2) continue;
      record1.playedMatchCount += 1;
      record2.playedMatchCount += 1;
      record1.matchAssignmentCount += 1;
      record2.matchAssignmentCount += 1;
      record1.gameWins += entry.player1Score;
      record1.gameLosses += entry.player2Score;
      record2.gameWins += entry.player2Score;
      record2.gameLosses += entry.player1Score;
      addLiveOpponent(opponentIdsByPlayer, player1.id, player2.id);
      addLiveOpponent(opponentIdsByPlayer, player2.id, player1.id);
      applyLiveMatchPoints(record1, record2, entry);
    }
  }

  return [...records.values()].map((record) => {
    const gameWinPercentage = percentage(record.gameWins, record.gameWins + record.gameLosses) ?? 0;
    const opponentIds = opponentIdsByPlayer.get(record.playerId) ?? [];
    return {
      ...record,
      rank: 0,
      gameWinPercentage,
      opponentsMatchWinPercentage: averageLiveOpponentPercentage(opponentIds, records, liveMatchWinPercentage),
      opponentsGameWinPercentage: averageLiveOpponentPercentage(opponentIds, records, liveGameWinPercentageForRecord)
    };
  }).sort(compareLiveStandingRows).map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyLiveMatchPoints(player: MutableLiveStandingRecord, opponent: MutableLiveStandingRecord, entry: MatchRoundEntry): void {
  if (entry.player1Score > entry.player2Score) {
    player.matchWins += 1;
    opponent.matchLosses += 1;
    player.points += 3;
  } else if (entry.player2Score > entry.player1Score) {
    opponent.matchWins += 1;
    player.matchLosses += 1;
    opponent.points += 3;
  } else {
    player.matchDraws += 1;
    opponent.matchDraws += 1;
    player.points += 1;
    opponent.points += 1;
  }
}

function addLiveOpponent(map: Map<string, string[]>, playerId: string, opponentId: string): void {
  map.set(playerId, [...(map.get(playerId) ?? []), opponentId]);
}

function liveMatchWinPercentage(record: MutableLiveStandingRecord | undefined): number | null {
  return record ? percentage(record.points, record.matchAssignmentCount * 3) : null;
}

function liveGameWinPercentageForRecord(record: MutableLiveStandingRecord | undefined): number | null {
  return record ? percentage(record.gameWins, record.gameWins + record.gameLosses) : null;
}

function averageLiveOpponentPercentage(opponentIds: string[], records: Map<string, MutableLiveStandingRecord>, getPercentage: (record: MutableLiveStandingRecord | undefined) => number | null): number {
  if (!opponentIds.length) return 0;
  const values = opponentIds.map((playerId) => Math.max(1 / 3, getPercentage(records.get(playerId)) ?? 0));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function compareLiveStandingRows(a: LiveStandingRow, b: LiveStandingRow): number {
  return b.points - a.points || b.opponentsMatchWinPercentage - a.opponentsMatchWinPercentage || b.gameWinPercentage - a.gameWinPercentage || b.opponentsGameWinPercentage - a.opponentsGameWinPercentage || b.matchWins - a.matchWins || a.playerName.localeCompare(b.playerName);
}

export function generateNextSwissRound(
  tournament: LiveTournamentDocument,
  { idFactory = defaultIdFactory, randomSeed = createPairingSeed }: { idFactory?: IdFactory; randomSeed?: () => number } = {}
): LiveTournamentDocument {
  const nextRoundNumber = tournament.rounds.filter((round) => round.validated).length + 1;
  if (nextRoundNumber > tournament.roundCount) return tournament;
  if (nextRoundNumber === 1) {
    const firstRound = buildFirstRoundPairings(tournament, { idFactory, randomSeed });
    const nextRound = normalizeLiveRound({ roundNumber: 1, entries: firstRound.entries, validated: false }, 1, { idFactory });
    return touch({
      ...tournament,
      pairingSeed: firstRound.pairingSeed,
      firstRoundPlayerOrder: firstRound.firstRoundPlayerOrder,
      stage: 'round',
      currentRoundNumber: 1,
      rounds: [nextRound]
    });
  }
  const entries = generateSwissPairings(tournament, nextRoundNumber, { idFactory });
  const nextRound = normalizeLiveRound({ roundNumber: nextRoundNumber, entries, validated: false }, nextRoundNumber, { idFactory });
  const checkpointed = tournament.stage === 'standings' ? withCheckpoint(tournament, `Standing ${tournament.currentRoundNumber}`, { idFactory }) : tournament;
  return touch({ ...checkpointed, stage: 'round', currentRoundNumber: nextRoundNumber, rounds: [...checkpointed.rounds.filter((round) => round.validated), nextRound] });
}

export function regenerateCurrentSwissRound(
  tournament: LiveTournamentDocument,
  { idFactory = defaultIdFactory, randomSeed = createPairingSeed }: { idFactory?: IdFactory; randomSeed?: () => number } = {}
): LiveTournamentDocument {
  const round = currentLiveRound(tournament);
  if (!round || round.validated) return tournament;
  if (round.roundNumber === 1) {
    // Explicit re-roll: new seed + clear locked order, then full random first round.
    const reseeded = { ...tournament, pairingSeed: 0, firstRoundPlayerOrder: [] as string[] };
    const firstRound = buildFirstRoundPairings(reseeded, { idFactory, randomSeed });
    return touch({
      ...tournament,
      pairingSeed: firstRound.pairingSeed,
      firstRoundPlayerOrder: firstRound.firstRoundPlayerOrder,
      rounds: tournament.rounds.map((item) => item.id === round.id ? normalizeLiveRound({ ...round, entries: firstRound.entries }, 1, { idFactory }) : item)
    });
  }
  const seededTournament = { ...tournament, pairingSeed: tournament.pairingSeed + 1 };
  const entries = generateSwissPairings(seededTournament, round.roundNumber, { idFactory });
  return touch({ ...seededTournament, rounds: tournament.rounds.map((item) => item.id === round.id ? normalizeLiveRound({ ...round, entries }, round.roundNumber, { idFactory }) : item) });
}

export function cancelCurrentSwissRound(tournament: LiveTournamentDocument): LiveTournamentDocument {
  const round = currentLiveRound(tournament);
  if (!round || round.validated) return tournament;
  const validatedRounds = tournament.rounds.filter((item) => item.validated);
  // Keep pairingSeed + firstRoundPlayerOrder so a re-launch reuses the first-round generation.
  return touch({ ...tournament, stage: validatedRounds.length ? 'standings' : 'registration', currentRoundNumber: validatedRounds.at(-1)?.roundNumber ?? 0, rounds: validatedRounds });
}

export function validateCurrentSwissRound(tournament: LiveTournamentDocument): LiveTournamentDocument {
  const round = currentLiveRound(tournament);
  if (!round || round.validated || !currentRoundComplete(tournament)) return tournament;
  const checkpointed = withCheckpoint(tournament, `Pairing ${round.roundNumber}`, { idFactory: defaultIdFactory });
  return touch({
    ...checkpointed,
    stage: 'standings',
    rounds: checkpointed.rounds.map((item) => item.id === round.id
      ? { ...item, validated: true, entries: item.entries.map((entry) => ({ ...entry, resultEntered: true })) }
      : item)
  });
}

export function updateLiveRoundEntryResult(tournament: LiveTournamentDocument, roundId: string, entryId: string, score: { player1Score: number; player2Score: number }): LiveTournamentDocument {
  return touch({
    ...tournament,
    rounds: tournament.rounds.map((round) => round.id !== roundId ? round : {
      ...round,
      entries: round.entries.map((item) => {
        if (item.entry.id !== entryId || item.entry.kind !== 'match') return item;
        return { ...item, resultEntered: true, entry: { ...item.entry, player1Score: toNonNegativeInteger(score.player1Score), player2Score: toNonNegativeInteger(score.player2Score) } };
      })
    })
  });
}

/**
 * The finished Live Tournament, in the shape the C# `LiveRules.Finalize` returns: the Live capability
 * names the target League on the record it hands over, and the API's archive writer is what turns that
 * into a Season reference (or a standalone Tournament when it is empty). Frozen by the cross-stack
 * Live parity corpus, so the field name stays `leagueId` here too.
 */
export interface LiveFinalizedTournament extends Omit<ArchiveTournamentDocument, 'seasonId'> {
  leagueId: string;
}

export function finalizeLiveTournament(tournament: LiveTournamentDocument, { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}): LiveFinalizedTournament {
  const { seasonId: _seasonId, ...archived } = createArchiveTournament({
    id: tournament.finalizedTournamentId,
    name: tournament.name,
    tournamentDate: tournament.tournamentDate,
    status: 'active',
    rounds: tournament.rounds.filter((round) => round.validated).map((round) => createRound({ entries: round.entries.map((item) => withLivePlayerArchetypes(item.entry, tournament)) }, { idFactory })),
    playerArchetypes: livePlayerArchetypeRows(tournament)
  }, { idFactory });
  // Key order is part of the frozen parity artifact: `id, leagueId, name, …`.
  return {
    id: archived.id,
    leagueId: tournament.leagueId,
    name: archived.name,
    tournamentDate: archived.tournamentDate,
    status: archived.status,
    rounds: archived.rounds,
    playerArchetypes: archived.playerArchetypes
  };
}

export function liveTournamentFinished(tournament: LiveTournamentDocument): boolean {
  return tournament.rounds.filter((round) => round.validated).length >= tournament.roundCount;
}

function livePlayerArchetypeRows(tournament: LiveTournamentDocument): PlayerArchetypeDocument[] {
  return tournament.players
    .map((player) => ({ playerName: trimPlayerName(player.name), archetype: String(player.archetype ?? '').trim() }))
    .filter((row) => row.playerName)
    .sort((left, right) => left.playerName.localeCompare(right.playerName));
}

function withLivePlayerArchetypes(entry: RoundEntry, tournament: LiveTournamentDocument): RoundEntry {
  if (entry.kind === 'match') {
    return {
      ...entry,
      player1DeckArchetype: liveArchetypeForPlayer(tournament, entry.player1Name),
      player2DeckArchetype: liveArchetypeForPlayer(tournament, entry.player2Name)
    };
  }
  if (entry.kind === 'bye') return { ...entry, deckArchetype: liveArchetypeForPlayer(tournament, entry.playerName) };
  return entry;
}

function liveArchetypeForPlayer(tournament: LiveTournamentDocument, playerName: string): string {
  const normalizedName = trimPlayerName(playerName);
  return tournament.players.find((player) => trimPlayerName(player.name) === normalizedName)?.archetype?.trim() ?? '';
}

function generateSwissPairings(tournament: LiveTournamentDocument, roundNumber: number, { idFactory }: { idFactory: IdFactory }): LiveTournamentRoundEntryDocument[] {
  const standings = calculateLiveStandings(tournament);
  const activeIds = new Set(activeLivePlayers(tournament).map((player) => player.id));
  const players = standings.filter((row) => activeIds.has(row.playerId));
  const entries: LiveTournamentRoundEntryDocument[] = [];
  let table = 1;

  if (players.length % 2 === 1) {
    const byeIndex = findByeCandidateIndex(players, tournament);
    const [byePlayer] = players.splice(byeIndex, 1);
    entries.push({ entry: createByeRoundEntry({ table: String(Math.ceil(players.length / 2) + 1), playerName: byePlayer.playerName }, { idFactory }), resultEntered: true });
  }

  while (players.length >= 2) {
    const player = players.shift()!;
    const opponentIndex = findOpponentIndex(player.playerName, players, tournament);
    const [opponent] = players.splice(opponentIndex, 1);
    entries.push({ entry: createMatchRoundEntry({ table: String(table++), player1Name: player.playerName, player2Name: opponent.playerName, player1Score: 0, player2Score: 0 }, { idFactory }), resultEntered: false });
  }

  return entries.sort((left, right) => Number(left.entry.table || 0) - Number(right.entry.table || 0));
}

function buildFirstRoundPairings(
  tournament: LiveTournamentDocument,
  { idFactory, randomSeed }: { idFactory: IdFactory; randomSeed: () => number }
): { entries: LiveTournamentRoundEntryDocument[]; pairingSeed: number; firstRoundPlayerOrder: string[] } {
  const active = activeLivePlayers(tournament);
  const activeById = new Map(active.map((player) => [player.id, player]));
  const lockedOrder = normalizePlayerIdList(tournament.firstRoundPlayerOrder).filter((id) => activeById.has(id));
  const lockedSet = new Set(lockedOrder);
  const newcomers = active.filter((player) => !lockedSet.has(player.id));

  // Fresh launch (or no locked cohort yet): randomize everyone with a new/non-zero seed.
  if (!tournament.pairingSeed || lockedOrder.length === 0) {
    const pairingSeed = tournament.pairingSeed || randomSeed();
    const firstRoundPlayerOrder = seededShuffle(active.map((player) => player.id), pairingSeed);
    return {
      pairingSeed,
      firstRoundPlayerOrder,
      entries: entriesFromPlayerOrder(firstRoundPlayerOrder, activeById, { idFactory })
    };
  }

  const pairingSeed = tournament.pairingSeed;

  // Same roster re-launch after cancel: rebuild exact prior order.
  if (!newcomers.length) {
    return {
      pairingSeed,
      firstRoundPlayerOrder: lockedOrder,
      entries: entriesFromPlayerOrder(lockedOrder, activeById, { idFactory })
    };
  }

  // One new player: play previous bye if any, otherwise take the bye. Never reshuffle locked pairings.
  if (newcomers.length === 1) {
    const newPlayerId = newcomers[0].id;
    let nextOrder: string[];
    if (lockedOrder.length % 2 === 1) {
      const byePlayerId = lockedOrder[lockedOrder.length - 1];
      nextOrder = [...lockedOrder.slice(0, -1), byePlayerId, newPlayerId];
    } else {
      nextOrder = [...lockedOrder, newPlayerId];
    }
    return {
      pairingSeed,
      firstRoundPlayerOrder: nextOrder,
      entries: entriesFromPlayerOrder(nextOrder, activeById, { idFactory })
    };
  }

  // Multiple new players: keep locked pairings/bye intact; only pair newcomers among themselves.
  const newOrder = seededShuffle(newcomers.map((player) => player.id), mixSeed(pairingSeed, newcomers.length));
  const lockedEntries = entriesFromPlayerOrder(lockedOrder, activeById, { idFactory });
  const newEntries = entriesFromPlayerOrder(newOrder, activeById, { idFactory, tableOffset: lockedEntries.length });
  return {
    pairingSeed,
    firstRoundPlayerOrder: [...lockedOrder, ...newOrder],
    entries: [...lockedEntries, ...newEntries].sort((left, right) => Number(left.entry.table || 0) - Number(right.entry.table || 0))
  };
}

function entriesFromPlayerOrder(
  order: string[],
  activeById: Map<string, LiveTournamentPlayerDocument>,
  { idFactory, tableOffset = 0 }: { idFactory: IdFactory; tableOffset?: number }
): LiveTournamentRoundEntryDocument[] {
  const ids = order.filter((id) => activeById.has(id));
  const entries: LiveTournamentRoundEntryDocument[] = [];
  let table = tableOffset + 1;
  let byeId: string | null = null;
  if (ids.length % 2 === 1) byeId = ids.pop() ?? null;

  while (ids.length >= 2) {
    const player1 = activeById.get(ids.shift()!)!;
    const player2 = activeById.get(ids.shift()!)!;
    entries.push({
      entry: createMatchRoundEntry({
        table: String(table++),
        player1Name: player1.name,
        player2Name: player2.name,
        player1Score: 0,
        player2Score: 0
      }, { idFactory }),
      resultEntered: false
    });
  }

  if (byeId) {
    const byePlayer = activeById.get(byeId)!;
    entries.push({
      entry: createByeRoundEntry({ table: String(table), playerName: byePlayer.name }, { idFactory }),
      resultEntered: true
    });
  }

  return entries;
}

function createPairingSeed(): number {
  const bytes = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(bytes);
  const value = bytes[0] || Math.floor(Math.random() * 0xffffffff);
  return (value >>> 0) || 1;
}

function mixSeed(seed: number, salt: number): number {
  return ((seed >>> 0) ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0 || 1;
}

/** Deterministic Fisher–Yates using mulberry32. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = arr.length - 1; index > 0; index--) {
    const swapWith = Math.floor(next() * (index + 1));
    [arr[index], arr[swapWith]] = [arr[swapWith], arr[index]];
  }
  return arr;
}

function normalizePlayerIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function findOpponentIndex(playerName: string, candidates: LiveStandingRow[], tournament: LiveTournamentDocument): number {
  const index = candidates.findIndex((candidate) => !havePlayed(tournament, playerName, candidate.playerName));
  return index === -1 ? 0 : index;
}

function findByeCandidateIndex(players: LiveStandingRow[], tournament: LiveTournamentDocument): number {
  for (let index = players.length - 1; index >= 0; index--) {
    if (!hasHadBye(tournament, players[index].playerName)) return index;
  }
  return players.length - 1;
}

function havePlayed(tournament: LiveTournamentDocument, left: string, right: string): boolean {
  return tournament.rounds.some((round) => round.validated && round.entries.some(({ entry }) => entry.kind === 'match' && samePair(entry.player1Name, entry.player2Name, left, right)));
}

function samePair(a: string, b: string, left: string, right: string): boolean {
  return (a === left && b === right) || (a === right && b === left);
}

function hasHadBye(tournament: LiveTournamentDocument, playerName: string): boolean {
  return tournament.rounds.some((round) => round.validated && round.entries.some(({ entry }) => entry.kind === 'bye' && entry.playerName === playerName));
}

function findPlayerByName(tournament: LiveTournamentDocument, playerName: string): LiveTournamentPlayerDocument | null {
  const normalized = trimPlayerName(playerName);
  return tournament.players.find((player) => trimPlayerName(player.name) === normalized) ?? null;
}

function normalizeLivePlayers(players: Partial<LiveTournamentPlayerDocument>[], { idFactory }: { idFactory: IdFactory }): LiveTournamentPlayerDocument[] {
  const counts = new Map<string, number>();
  return players.map((player) => {
    const normalized = createLiveTournamentPlayer(player, { idFactory });
    const key = normalized.name.toLowerCase();
    if (!key) return normalized;
    const nextCount = (counts.get(key) ?? 0) + 1;
    counts.set(key, nextCount);
    return nextCount === 1 ? normalized : { ...normalized, name: `${normalized.name} (${nextCount})` };
  });
}

function normalizeLiveRound(round: Partial<LiveTournamentRoundDocument>, fallbackRoundNumber: number, { idFactory }: { idFactory: IdFactory }): LiveTournamentRoundDocument {
  return {
    id: round.id ?? idFactory(),
    roundNumber: toNonNegativeInteger(round.roundNumber) || fallbackRoundNumber,
    entries: normalizeLiveRoundEntries(round.entries, { idFactory }),
    validated: Boolean(round.validated)
  };
}

function normalizeLiveRoundEntries(entries: Partial<LiveTournamentRoundEntryDocument>[] | undefined, { idFactory }: { idFactory: IdFactory }): LiveTournamentRoundEntryDocument[] {
  const safeEntries = Array.isArray(entries) ? entries : [];
  return safeEntries.flatMap((item) => {
    if (!item?.entry || !isRoundEntryKind(item.entry)) return [];
    const entry = createRoundEntry(item.entry, { idFactory });
    return [{ entry, resultEntered: entry.kind === 'bye' || Boolean(item.resultEntered) }];
  });
}

function isRoundEntryKind(entry: Partial<RoundEntry>): entry is Partial<RoundEntry> & Pick<RoundEntry, 'kind'> {
  return entry.kind === 'match' || entry.kind === 'bye' || entry.kind === 'invalid';
}

function normalizeLiveCheckpoint(checkpoint: Partial<LiveTournamentCheckpointDocument>, { idFactory }: { idFactory: IdFactory }): LiveTournamentCheckpointDocument {
  const stage = checkpoint.stage === 'standings' ? 'standings' : 'round';
  return {
    id: checkpoint.id ?? idFactory(),
    label: String(checkpoint.label || (stage === 'round' ? 'Pairing backup' : 'Standing backup')),
    createdAt: String(checkpoint.createdAt || new Date().toISOString()),
    stage,
    currentRoundNumber: toNonNegativeInteger(checkpoint.currentRoundNumber),
    roundCount: Math.max(0, toNonNegativeInteger(checkpoint.roundCount)),
    paidTrackingEnabled: checkpoint.paidTrackingEnabled !== false,
    players: normalizeLivePlayers(checkpoint.players ?? [], { idFactory }),
    rounds: (checkpoint.rounds ?? []).map((round, index) => normalizeLiveRound(round, index + 1, { idFactory }))
  };
}

function withCheckpoint(tournament: LiveTournamentDocument, label: string, { idFactory }: { idFactory: IdFactory }): LiveTournamentDocument {
  if (tournament.stage !== 'round' && tournament.stage !== 'standings') return tournament;
  const checkpoint: LiveTournamentCheckpointDocument = normalizeLiveCheckpoint({
    id: idFactory(),
    label,
    createdAt: new Date().toISOString(),
    stage: tournament.stage,
    currentRoundNumber: tournament.currentRoundNumber,
    roundCount: tournament.roundCount,
    paidTrackingEnabled: tournament.paidTrackingEnabled,
    players: tournament.players,
    rounds: tournament.rounds
  }, { idFactory });
  return { ...tournament, checkpoints: [...tournament.checkpoints, checkpoint].slice(-80) };
}

function touch(tournament: LiveTournamentDocument): LiveTournamentDocument {
  return { ...tournament, updatedAt: new Date().toISOString() };
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function todayDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
