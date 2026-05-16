import { createByeRoundEntry, createGonesData, createLeague, createMatchRoundEntry } from "./models.js";
import { calculatePlayerStatistics } from "./player-stats.js";

describe("Player Statistics", () => {
  it("aggregates exact case-sensitive Player Names", () => {
    const data = dataWithEntries([match("Alice", "Bob", "Won 2-0"), match("alice", "Bob", "Won 2-0")]);
    expect(calculatePlayerStatistics(data, "Alice").playedMatchCount).toBe(1);
  });

  it("excludes Byes from match and game winrates while counting Bye Count", () => {
    const stats = calculatePlayerStatistics(dataWithEntries([createByeRoundEntry({ player: "Alice" })]), "Alice");
    expect(stats.byeCount).toBe(1);
    expect(stats.matchWinrate).toBeNull();
    expect(stats.gameWinrate).toBeNull();
  });

  it("calculates Nemesis and Rival", () => {
    const data = dataWithEntries([match("Alice", "Bob", "Lost 0-2"), match("Alice", "Bob", "Won 2-0"), match("Alice", "Cara", "Lost 0-2")]);
    const stats = calculatePlayerStatistics(data, "Alice");
    expect(stats.nemesis).toBe("Bob");
    expect(stats.rival).toBe("Bob");
  });

  it("filters matches by opponent name case-insensitively", () => {
    const data = dataWithEntries([match("Alice", "Bob", "Won 2-0"), match("Alice", "Cara", "Lost 0-2")]);
    const stats = calculatePlayerStatistics(data, "Alice", { opponentName: "bo" });
    expect(stats.playedMatchCount).toBe(1);
    expect(stats.matches).toHaveLength(1);
    expect(stats.matches[0].opponentName).toBe("Bob");
  });
});

function dataWithEntries(entries) {
  return createGonesData({ leagues: [createLeague({ tournaments: [{ rounds: [{ entries }] }] })] });
}

function match(player, opponent, result) {
  return createMatchRoundEntry({ player, opponent, result });
}
