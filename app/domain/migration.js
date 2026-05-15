import {
  createByeRoundEntry,
  createGonesData,
  createInvalidRoundEntry,
  createLeague,
  createMatchRoundEntry,
  createRound,
  createTournament
} from "./models.js";

export function migrateLegacyLeagueList(rawValue, { idFactory } = {}) {
  if (!rawValue) return null;
  let legacyLeagues;
  try {
    legacyLeagues = JSON.parse(rawValue);
  } catch {
    return null;
  }
  if (!Array.isArray(legacyLeagues)) return null;

  return createGonesData({
    leagues: legacyLeagues.map((legacyLeague) => {
      const league = createLeague(
        {
          name: legacyLeague.name ?? legacyLeague.title ?? "Migrated League",
          startDate: legacyLeague.startDate ?? legacyLeague.start_date ?? "",
          endDate: legacyLeague.endDate ?? legacyLeague.end_date ?? "",
          tournaments: []
        },
        { idFactory }
      );
      const tournaments = legacyLeague.tournaments ?? legacyLeague.tournament_list ?? [];
      league.tournaments = tournaments.map((legacyTournament) => migrateTournament(legacyTournament, league.id, { idFactory }));
      return league;
    })
  });
}

function migrateTournament(legacyTournament, leagueId, { idFactory }) {
  return createTournament(
    {
      leagueId,
      name: legacyTournament.name ?? legacyTournament.title ?? "Migrated Tournament",
      tournamentDate: legacyTournament.tournamentDate ?? legacyTournament.date ?? "",
      rounds: (legacyTournament.rounds ?? legacyTournament.round_list ?? []).map((legacyRound) =>
        createRound(
          { entries: migrateRoundEntries(getLegacyRoundEntries(legacyRound), { idFactory }) },
          { idFactory }
        )
      )
    },
    { idFactory }
  );
}

function migrateRoundEntries(legacyEntries, { idFactory } = {}) {
  if (!Array.isArray(legacyEntries)) return [];
  return legacyEntries.map((entry) => {
    const player = entry.playerName ?? entry.player ?? entry.winner;
    const opponent = entry.opponentName ?? entry.opponent ?? entry.loser;
    if (String(opponent ?? "").trim().toLowerCase() === "bye") {
      return createByeRoundEntry({ playerName: player }, { idFactory });
    }
    if (player && opponent && entry.winner && entry.loser) {
      return createMatchRoundEntry({ player1Name: entry.winner, player2Name: entry.loser, player1Score: 1, player2Score: 0 }, { idFactory });
    }
    if (player && opponent) {
      return createMatchRoundEntry({ player1Name: player, player2Name: opponent, player1Score: entry.playerScore ?? 0, player2Score: entry.opponentScore ?? 0 }, { idFactory });
    }
    return createInvalidRoundEntry({ rawText: JSON.stringify(entry) }, { idFactory });
  });
}

function getLegacyRoundEntries(legacyRound) {
  if (Array.isArray(legacyRound)) return legacyRound;
  if (Array.isArray(legacyRound?.entries)) return legacyRound.entries;
  if (Array.isArray(legacyRound?.matches)) return legacyRound.matches;
  return [];
}
