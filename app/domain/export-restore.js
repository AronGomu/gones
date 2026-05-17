import { GONES_DATA_VERSION, createByeRoundEntry, createInvalidRoundEntry, createLeague, createMatchRoundEntry, createRound, createTournament } from "./models.js";

export function exportLeague(league) {
  if (!league?.id) throw new Error("invalidLeague");
  return { version: GONES_DATA_VERSION, exportedAt: new Date().toISOString(), league: structuredClone(league) };
}

export function restoreLeague(exportedLeague, { idFactory, existingLeagues = [] } = {}) {
  if (!exportedLeague || exportedLeague.version !== GONES_DATA_VERSION || !exportedLeague.league) throw new Error("unsupportedGonesExport");
  const source = exportedLeague.league;
  const duplicateName = existingLeagues.some((league) => league.name === source.name);
  const league = createLeague({ name: duplicateName ? `${source.name} (restored)` : source.name, status: source.status, tournaments: [] }, { idFactory });
  league.tournaments = (source.tournaments ?? []).map((tournament) => remapTournament(tournament, league.id, { idFactory }));
  return league;
}

function remapTournament(source, leagueId, { idFactory }) {
  const tournament = createTournament({ leagueId, name: source.name, tournamentDate: source.tournamentDate, rounds: [] }, { idFactory });
  tournament.rounds = (source.rounds ?? []).map((round) => remapRound(round, { idFactory }));
  return tournament;
}

function remapRound(source, { idFactory }) {
  const round = createRound({ entries: [] }, { idFactory });
  round.entries = (source.entries ?? []).map((entry) => remapEntry(entry, { idFactory }));
  return round;
}

function remapEntry(entry, { idFactory }) {
  const { id, ...entryWithoutId } = entry;
  if (entry.kind === "invalid") return createInvalidRoundEntry(entryWithoutId, { idFactory });
  if (entry.kind === "bye") return createByeRoundEntry(entryWithoutId, { idFactory });
  return createMatchRoundEntry(entryWithoutId, { idFactory });
}
