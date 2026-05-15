import { migrateLegacyLeagueList } from "./migration.js";

describe("legacy migration", () => {
  it("migrates old bye rows", () => {
    const data = migrateLegacyLeagueList(JSON.stringify([{ tournament_list: [{ round_list: [[{ player: "Alice", opponent: "bye" }]] }] }]));
    expect(data.leagues[0].tournaments[0].rounds[0].entries[0]).toMatchObject({ kind: "bye", playerName: "Alice" });
  });

  it("migrates old winner and loser rows to neutral matches", () => {
    const data = migrateLegacyLeagueList(JSON.stringify([{ tournament_list: [{ round_list: [[{ winner: "Alice", loser: "Bob" }]] }] }]));
    expect(data.leagues[0].tournaments[0].rounds[0].entries[0]).toMatchObject({ kind: "match", player1Name: "Alice", player2Name: "Bob" });
  });

  it("does not migrate old standings into source data", () => {
    const data = migrateLegacyLeagueList(JSON.stringify([{ standings: [{ player: "Alice" }] }]));
    expect(data.leagues[0].tournaments).toEqual([]);
  });
});

