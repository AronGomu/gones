import { createGonesData, createIdFactory, createLeague, createMatchRoundEntry } from "./models.js";

describe("source model builders", () => {
  it("creates versioned Gones data", () => {
    expect(createGonesData()).toEqual({ version: 1, leagues: [] });
  });

  it("trims Player Names", () => {
    expect(createMatchRoundEntry({ player1Name: " Ada ", player2Name: " Grace " })).toMatchObject({
      player1Name: "Ada",
      player2Name: "Grace"
    });
  });

  it("accepts injected ID factories", () => {
    const idFactory = createIdFactory("test");
    const league = createLeague({ tournaments: [{ rounds: [{ entries: [{ player1Name: "A", player2Name: "B" }] }] }] }, { idFactory });

    expect(league.id).toBe("test-1");
    expect(league.tournaments[0].id).toBe("test-2");
    expect(league.tournaments[0].rounds[0].id).toBe("test-3");
    expect(league.tournaments[0].rounds[0].entries[0].id).toBe("test-4");
  });

  it("defaults League status to active and only accepts known statuses", () => {
    expect(createLeague().status).toBe("active");
    expect(createLeague({ status: "finished" }).status).toBe("finished");
    expect(createLeague({ status: "paused" }).status).toBe("active");
  });
});
