import { createIdFactory, createLeague } from "./models.js";
import { exportLeague, restoreLeague } from "./export-restore.js";

describe("Gones Export and Restore", () => {
  it("exports source data only", () => {
    const exported = exportLeague(createLeague({ name: "League", tournaments: [{ rounds: [{ entries: [{ player1Name: "A", player2Name: "B" }] }] }] }));
    expect(exported).toHaveProperty("version", 1);
    expect(exported).toHaveProperty("league");
    expect(exported).not.toHaveProperty("rows");
  });

  it("restores as a new League with remapped IDs", () => {
    const source = createLeague({ id: "league-old", name: "League", tournaments: [{ id: "t-old", rounds: [{ id: "r-old", entries: [{ id: "e-old", player1Name: "A", player2Name: "B" }] }] }] });
    const restored = restoreLeague(exportLeague(source), { idFactory: createIdFactory("new") });
    expect(restored.id).toBe("new-1");
    expect(restored.tournaments[0].id).toBe("new-2");
    expect(restored.tournaments[0].rounds[0].id).toBe("new-3");
    expect(restored.tournaments[0].rounds[0].entries[0].id).toBe("new-4");
  });

  it("preserves Invalid Round Entries", () => {
    const source = createLeague({ tournaments: [{ rounds: [{ entries: [{ kind: "invalid", rawText: "bad row" }] }] }] });
    const restored = restoreLeague(exportLeague(source), { idFactory: createIdFactory("new") });
    expect(restored.tournaments[0].rounds[0].entries[0]).toMatchObject({ kind: "invalid", rawText: "bad row" });
  });
});

