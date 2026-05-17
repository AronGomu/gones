import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIdFactory, createLeague } from "./models.js";
import { exportLeague, restoreLeague } from "./export-restore.js";
import { getTournamentWarnings } from "./warnings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Gones Export and Restore", () => {
  it("exports source data only", () => {
    const exported = exportLeague(createLeague({ name: "League", tournaments: [{ rounds: [{ entries: [{ player: "A", opponent: "B", result: "Won 2-0" }] }] }] }));
    expect(exported).toHaveProperty("version", 1);
    expect(exported).toHaveProperty("league");
    expect(exported).not.toHaveProperty("rows");
  });

  it("restores as a new League with remapped IDs", () => {
    const source = createLeague({ id: "league-old", name: "League", tournaments: [{ id: "t-old", rounds: [{ id: "r-old", entries: [{ id: "e-old", player: "A", opponent: "B", result: "Won 2-0" }] }] }] });
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

  it("preserves League status", () => {
    const source = createLeague({ status: "finished" });
    const restored = restoreLeague(exportLeague(source), { idFactory: createIdFactory("new") });
    expect(restored.status).toBe("finished");
  });

  it("restores clean real League data without false missing bye warnings", () => {
    const exported = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/gones-league-6.clean.json"), "utf8"));
    const restored = restoreLeague(exported, { idFactory: createIdFactory("new") });
    const warnings = restored.tournaments.flatMap((tournament) => getTournamentWarnings(tournament));
    expect(warnings.filter((warning) => warning.code === "missingBye")).toEqual([]);
  });
});
