import { createGonesData, createIdFactory, createLeague, createMatchRoundEntry } from "./models.js";

describe("source model builders", () => {
  it("creates empty data", () => {
    expect(createGonesData()).toEqual({ version: 1, leagues: [] });
  });

  it("trims Player Names", () => {
    expect(createMatchRoundEntry({ player: " Ada ", opponent: " Grace " })).toMatchObject({ player: "Ada", opponent: "Grace" });
  });

  it("assigns ids through injected factory", () => {
    const idFactory = createIdFactory("test");
    const league = createLeague({ tournaments: [{ rounds: [{ entries: [{ player: "A", opponent: "B", result: "Won 2-0" }] }] }] }, { idFactory });
    expect(league.id).toBe("test-1");
    expect(league.tournaments[0].id).toBe("test-2");
    expect(league.tournaments[0].rounds[0].id).toBe("test-3");
    expect(league.tournaments[0].rounds[0].entries[0].id).toBe("test-4");
  });
});
