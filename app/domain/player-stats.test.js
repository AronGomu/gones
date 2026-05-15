import { createByeRoundEntry, createGonesData, createLeague, createMatchRoundEntry } from "./models.js";
import { calculatePlayerStatistics } from "./player-stats.js";

describe("Player Statistics", () => {
  it("aggregates exact case-sensitive Player Names", () => {
    const data = dataWithEntries([match("Alice", "Bob", 2, 0), match("alice", "Bob", 2, 0)]);
    expect(calculatePlayerStatistics(data, "Alice").playedMatchCount).toBe(1);
  });

  it("excludes Byes from match and game winrates while counting Bye Count", () => {
    const stats = calculatePlayerStatistics(dataWithEntries([createByeRoundEntry({ playerName: "Alice" })]), "Alice");
    expect(stats.byeCount).toBe(1);
    expect(stats.matchWinrate).toBeNull();
    expect(stats.gameWinrate).toBeNull();
  });

  it("calculates Nemesis and Rival", () => {
    const data = dataWithEntries([match("Alice", "Bob", 0, 2), match("Alice", "Bob", 2, 0), match("Alice", "Cara", 0, 2)]);
    const stats = calculatePlayerStatistics(data, "Alice");
    expect(stats.nemesis).toBe("Bob");
    expect(stats.rival).toBe("Bob");
  });
});

function dataWithEntries(entries) {
  return createGonesData({
    leagues: [
      createLeague({
        tournaments: [{ rounds: [{ entries }] }]
      })
    ]
  });
}

function match(player1Name, player2Name, player1Score, player2Score) {
  return createMatchRoundEntry({ player1Name, player2Name, player1Score, player2Score });
}

