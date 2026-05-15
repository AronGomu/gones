import { createByeRoundEntry, createMatchRoundEntry } from "./models.js";
import { validateRoundEntry } from "./validation.js";

describe("Round Entry validation", () => {
  it("rejects empty Player Names", () => {
    expect(validateRoundEntry(createMatchRoundEntry({ player1Name: "", player2Name: "Bob" })).codes).toContain("player1NameRequired");
  });

  it("rejects reserved bye Player Names", () => {
    expect(validateRoundEntry(createByeRoundEntry({ playerName: "bye" })).codes).toContain("byeReservedPlayerName");
  });

  it("rejects same Player Name matches", () => {
    expect(validateRoundEntry(createMatchRoundEntry({ player1Name: "Alice", player2Name: "Alice" })).codes).toContain("samePlayerName");
  });

  it("rejects decimal and negative scores", () => {
    const validation = validateRoundEntry(createMatchRoundEntry({ player1Name: "Alice", player2Name: "Bob", player1Score: "1.5", player2Score: "-1" }));
    expect(validation.codes).toEqual(expect.arrayContaining(["player1ScoreInvalid", "player2ScoreInvalid"]));
  });

  it("rejects 2-2 draws", () => {
    expect(validateRoundEntry(createMatchRoundEntry({ player1Name: "Alice", player2Name: "Bob", player1Score: 2, player2Score: 2 })).codes).toContain("drawScoreInvalid");
  });
});

