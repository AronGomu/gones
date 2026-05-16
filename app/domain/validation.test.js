import { createByeRoundEntry, createMatchRoundEntry } from "./models.js";
import { validateRoundEntry } from "./validation.js";

describe("Round Entry validation", () => {
  it("rejects empty Player Names", () => {
    expect(validateRoundEntry(createMatchRoundEntry({ player: "", opponent: "Bob", result: "Won 2-0" })).codes).toContain("playerRequired");
  });

  it("rejects reserved bye Player Names", () => {
    expect(validateRoundEntry(createByeRoundEntry({ player: "bye" })).codes).toContain("byeReservedPlayerName");
  });

  it("rejects same Player Name matches", () => {
    expect(validateRoundEntry(createMatchRoundEntry({ player: "Alice", opponent: "Alice", result: "Won 2-0" })).codes).toContain("samePlayerName");
  });

  it("rejects invalid results", () => {
    expect(validateRoundEntry(createMatchRoundEntry({ player: "Alice", opponent: "Bob", result: "Lost 2-0" })).codes).toContain("resultInvalid");
  });
});
