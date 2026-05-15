import { createByeRoundEntry, createLeague, createMatchRoundEntry, createRound, createTournament } from "./models.js";
import { calculateLeagueResult, calculateTournamentResult } from "./results.js";

describe("Tournament and League Results", () => {
  it("awards 3 points for a match win", () => {
    const result = calculateTournamentResult(tournamentWithEntries([match("Alice", "Bob", 2, 0)]));
    expect(result.rows[0]).toMatchObject({ playerName: "Alice", points: 3, matchWins: 1 });
  });

  it("awards 1 point each for a draw", () => {
    const result = calculateTournamentResult(tournamentWithEntries([match("Alice", "Bob", 1, 1)]));
    expect(result.rows.map((row) => row.points)).toEqual([1, 1]);
  });

  it("awards byes as ranking wins and excludes them from game wins", () => {
    const result = calculateTournamentResult(tournamentWithEntries([createByeRoundEntry({ playerName: "Alice" })]));
    expect(result.rows[0]).toMatchObject({ playerName: "Alice", points: 3, matchWins: 1, byes: 1, gameWins: 0 });
  });

  it("sorts by points before tiebreakers and Player Name", () => {
    const result = calculateTournamentResult(tournamentWithEntries([match("Bob", "Alice", 2, 0), match("Cara", "Dan", 2, 0)]));
    expect(result.rows.map((row) => row.playerName)).toEqual(["Bob", "Cara", "Alice", "Dan"]);
  });

  it("sums League Result points across Tournaments", () => {
    const league = createLeague({
      tournaments: [
        { rounds: [{ entries: [match("Alice", "Bob", 2, 0)] }] },
        { rounds: [{ entries: [match("Alice", "Cara", 2, 0)] }] }
      ]
    });
    expect(calculateLeagueResult(league).rows[0]).toMatchObject({ playerName: "Alice", points: 6 });
  });

  it("uses valid entries from incomplete Tournaments for provisional results", () => {
    const tournament = tournamentWithEntries([match("Alice", "Bob", 2, 0), { kind: "invalid", id: "bad", rawText: "bad" }]);
    const result = calculateTournamentResult(tournament);
    expect(result).toMatchObject({ incomplete: true, provisional: true });
    expect(result.rows[0].playerName).toBe("Alice");
  });
});

function tournamentWithEntries(entries) {
  return createTournament({ rounds: [createRound({ entries })] });
}

function match(player1Name, player2Name, player1Score, player2Score) {
  return createMatchRoundEntry({ player1Name, player2Name, player1Score, player2Score });
}

