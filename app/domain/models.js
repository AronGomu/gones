export const GONES_DATA_VERSION = 1;
export const LEAGUE_STATUSES = ["active", "finished"];

export function createIdFactory(prefix = "id") {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

export function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function trimPlayerName(value) {
  return String(value ?? "").trim();
}

export function createGonesData({ leagues = [] } = {}) {
  return { version: GONES_DATA_VERSION, leagues: leagues.map((league) => normalizeLeague(league)) };
}

export function createLeague({ id, name = "New League", status = "active", tournaments = [] } = {}, { idFactory = defaultIdFactory } = {}) {
  const leagueId = id ?? idFactory();
  return {
    id: leagueId,
    name: String(name || "New League").trim() || "New League",
    status: normalizeLeagueStatus(status),
    tournaments: tournaments.map((tournament) => createTournament({ ...tournament, leagueId: tournament.leagueId ?? leagueId }, { idFactory }))
  };
}

export function normalizeLeague(league = {}, { idFactory = defaultIdFactory } = {}) {
  return createLeague(league, { idFactory });
}

export function normalizeLeagueStatus(status) {
  return LEAGUE_STATUSES.includes(status) ? status : "active";
}

export function createTournament({ id, leagueId = "", name = getDefaultTournamentName(), tournamentDate = "", rounds = [] } = {}, { idFactory = defaultIdFactory } = {}) {
  return {
    id: id ?? idFactory(),
    leagueId,
    name: String(name || getDefaultTournamentName()).trim() || getDefaultTournamentName(),
    tournamentDate: String(tournamentDate ?? ""),
    rounds: rounds.map((round) => createRound(round, { idFactory }))
  };
}

export function getDefaultTournamentName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function createRound({ id, entries = [] } = {}, { idFactory = defaultIdFactory } = {}) {
  return { id: id ?? idFactory(), entries: entries.map((entry, index) => createRoundEntry({ table: String(index + 1), ...entry }, { idFactory })) };
}

export function createRoundEntry(entry = {}, { idFactory = defaultIdFactory } = {}) {
  if (entry.kind === "bye") return createByeRoundEntry(entry, { idFactory });
  if (entry.kind === "invalid") return createInvalidRoundEntry(entry, { idFactory });
  return createMatchRoundEntry(entry, { idFactory });
}

export function createMatchRoundEntry({ id, table = "", player = "", result = "", opponent = "", playerDecklist = "", opponentDecklist = "" } = {}, { idFactory = defaultIdFactory } = {}) {
  return {
    kind: "match",
    id: id ?? idFactory(),
    table: String(table ?? ""),
    player: trimPlayerName(player),
    result: String(result ?? ""),
    opponent: trimPlayerName(opponent),
    playerDecklist: String(playerDecklist ?? ""),
    opponentDecklist: String(opponentDecklist ?? "")
  };
}

export function createByeRoundEntry({ id, table = "", player = "", playerDecklist = "" } = {}, { idFactory = defaultIdFactory } = {}) {
  return { kind: "bye", id: id ?? idFactory(), table: String(table ?? ""), player: trimPlayerName(player), playerDecklist: String(playerDecklist ?? "") };
}

export function createInvalidRoundEntry({ id, rawText = "", table = "", player = "", result = "", opponent = "", playerDecklist = "", opponentDecklist = "" } = {}, { idFactory = defaultIdFactory } = {}) {
  return {
    kind: "invalid",
    id: id ?? idFactory(),
    rawText: String(rawText ?? ""),
    table: String(table ?? ""),
    player: trimPlayerName(player),
    result: String(result ?? ""),
    opponent: trimPlayerName(opponent),
    playerDecklist: String(playerDecklist ?? ""),
    opponentDecklist: String(opponentDecklist ?? "")
  };
}
