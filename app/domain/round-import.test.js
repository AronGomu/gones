import { createIdFactory } from "./models.js";
import { importRoundEntries } from "./round-import.js";

const header = "Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist";

describe("Round Import", () => {
  it("imports SpiceRack CSV and skips the header", () => {
    const result = importRoundEntries(`${header}\n1,Alice,Won 2-1,Bob,Tempo,Control`);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ kind: "match", table: "1", player: "Alice", result: "Won 2-1", opponent: "Bob", playerDecklist: "Tempo", opponentDecklist: "Control" });
  });

  it("imports lost and draw results", () => {
    expect(importRoundEntries(`${header}\n2,Alice,Lost 0-2,Bob,,`).entries[0]).toMatchObject({ kind: "match", result: "Lost 0-2" });
    expect(importRoundEntries(`${header}\n3,Alice,Draw 1-1,Bob,,`).entries[0]).toMatchObject({ kind: "match", result: "Draw 1-1" });
  });

  it("preserves internal spaces and quoted commas", () => {
    expect(importRoundEntries(`${header}\n1,"Alice, A.",Won 2-0,"Bob  B.",,`).entries[0]).toMatchObject({ player: "Alice, A.", opponent: "Bob  B." });
  });

  it("preserves malformed rows as Invalid Round Entries", () => {
    const idFactory = createIdFactory("row");
    expect(importRoundEntries(`${header}\nAlice,Bob,2,1,extra`, { idFactory }).entries[0]).toMatchObject({ kind: "invalid", id: "row-1", rawText: "Alice,Bob,2,1,extra" });
  });

  it("rejects old MVP rows", () => {
    expect(importRoundEntries("player_1,player_2,player_1_score,player_2_score\nAlice,Bob,2,1").entries.every((entry) => entry.kind === "invalid")).toBe(true);
  });
});
