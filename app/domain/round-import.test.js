import { createIdFactory } from "./models.js";
import { importRoundEntries } from "./round-import.js";

describe("Round Import", () => {
  it("imports valid match CSV and skips a matching header", () => {
    const result = importRoundEntries("player_1,player_2,player_1_score,player_2_score\nAlice,Bob,2,1");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ kind: "match", player1Name: "Alice", player2Name: "Bob", player1Score: "2", player2Score: "1" });
  });

  it("imports 0-0 as a drawn Match source row", () => {
    expect(importRoundEntries("Alice,Bob,0,0").entries[0]).toMatchObject({ kind: "match", player1Score: "0", player2Score: "0" });
  });

  it("imports bye rows case-insensitively and ignores scores", () => {
    expect(importRoundEntries("Alice,BYE,9,9").entries[0]).toMatchObject({ kind: "bye", playerName: "Alice" });
  });

  it("ignores blank lines and supports semicolon rows", () => {
    expect(importRoundEntries("\nAlice;Bob;2;0\n\n").entries).toHaveLength(1);
  });

  it("supports quoted commas", () => {
    expect(importRoundEntries('"Alice, A.",Bob,2,1').entries[0].player1Name).toBe("Alice, A.");
  });

  it("preserves malformed rows as Invalid Round Entries", () => {
    const idFactory = createIdFactory("row");
    expect(importRoundEntries("Alice,Bob,2,1,extra", { idFactory }).entries[0]).toEqual({
      kind: "invalid",
      id: "row-1",
      rawText: "Alice,Bob,2,1,extra",
      player1Name: "",
      player2Name: "",
      player1Score: "",
      player2Score: ""
    });
  });
});

