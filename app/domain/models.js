export const GONES_DATA_VERSION = 1;

/**
 * @typedef {Object} GonesData
 * @property {1} version
 * @property {League[]} leagues
 */

/**
 * @typedef {Object} League
 * @property {string} id
 * @property {string} name
 * @property {string} startDate
 * @property {string} endDate
 * @property {Tournament[]} tournaments
 */

/**
 * @typedef {Object} Tournament
 * @property {string} id
 * @property {string} leagueId
 * @property {string} name
 * @property {string} tournamentDate
 * @property {Round[]} rounds
 */

/**
 * @typedef {Object} Round
 * @property {string} id
 * @property {RoundEntry[]} entries
 */

/**
 * @typedef {MatchRoundEntry | ByeRoundEntry | InvalidRoundEntry} RoundEntry
 */

/**
 * @typedef {Object} MatchRoundEntry
 * @property {"match"} kind
 * @property {string} id
 * @property {string} player1Name
 * @property {string} player2Name
 * @property {number | string} player1Score
 * @property {number | string} player2Score
 */

/**
 * @typedef {Object} ByeRoundEntry
 * @property {"bye"} kind
 * @property {string} id
 * @property {string} playerName
 */

/**
 * @typedef {Object} InvalidRoundEntry
 * @property {"invalid"} kind
 * @property {string} id
 * @property {string} rawText
 * @property {string} player1Name
 * @property {string} player2Name
 * @property {number | string} player1Score
 * @property {number | string} player2Score
 */

export function createIdFactory(prefix = "id") {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

export function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function trimPlayerName(value) {
  return String(value ?? "").trim();
}

export function createGonesData({ leagues = [] } = {}) {
  return {
    version: GONES_DATA_VERSION,
    leagues
  };
}

export function createLeague(
  { id, name = "New League", startDate = "", endDate = "", tournaments = [] } = {},
  { idFactory = defaultIdFactory } = {}
) {
  const leagueId = id ?? idFactory();
  return {
    id: leagueId,
    name: String(name || "New League").trim() || "New League",
    startDate: String(startDate ?? ""),
    endDate: String(endDate ?? ""),
    tournaments: tournaments.map((tournament) =>
      createTournament({ ...tournament, leagueId: tournament.leagueId ?? leagueId }, { idFactory })
    )
  };
}

export function createTournament(
  { id, leagueId = "", name = "New Tournament", tournamentDate = "", rounds = [] } = {},
  { idFactory = defaultIdFactory } = {}
) {
  return {
    id: id ?? idFactory(),
    leagueId,
    name: String(name || "New Tournament").trim() || "New Tournament",
    tournamentDate: String(tournamentDate ?? ""),
    rounds: rounds.map((round) => createRound(round, { idFactory }))
  };
}

export function createRound({ id, entries = [] } = {}, { idFactory = defaultIdFactory } = {}) {
  return {
    id: id ?? idFactory(),
    entries: entries.map((entry) => createRoundEntry(entry, { idFactory }))
  };
}

export function createRoundEntry(entry = {}, { idFactory = defaultIdFactory } = {}) {
  if (entry.kind === "bye") return createByeRoundEntry(entry, { idFactory });
  if (entry.kind === "invalid") return createInvalidRoundEntry(entry, { idFactory });
  return createMatchRoundEntry(entry, { idFactory });
}

export function createMatchRoundEntry(
  { id, player1Name = "", player2Name = "", player1Score = 0, player2Score = 0 } = {},
  { idFactory = defaultIdFactory } = {}
) {
  return {
    kind: "match",
    id: id ?? idFactory(),
    player1Name: trimPlayerName(player1Name),
    player2Name: trimPlayerName(player2Name),
    player1Score,
    player2Score
  };
}

export function createByeRoundEntry({ id, playerName = "" } = {}, { idFactory = defaultIdFactory } = {}) {
  return {
    kind: "bye",
    id: id ?? idFactory(),
    playerName: trimPlayerName(playerName)
  };
}

export function createInvalidRoundEntry(
  {
    id,
    rawText = "",
    player1Name = "",
    player2Name = "",
    player1Score = "",
    player2Score = ""
  } = {},
  { idFactory = defaultIdFactory } = {}
) {
  return {
    kind: "invalid",
    id: id ?? idFactory(),
    rawText: String(rawText ?? ""),
    player1Name: trimPlayerName(player1Name),
    player2Name: trimPlayerName(player2Name),
    player1Score,
    player2Score
  };
}

