import { trimPlayerName } from "./models.js";

export function isReservedByeName(value) {
  return trimPlayerName(value).toLowerCase() === "bye";
}

export function toScore(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function validateRoundEntry(entry) {
  if (!entry || entry.kind === "invalid") {
    return { valid: false, codes: ["invalidRoundEntry"] };
  }
  if (entry.kind === "bye") return validateBye(entry);
  if (entry.kind === "match") return validateMatch(entry);
  return { valid: false, codes: ["unknownRoundEntryKind"] };
}

export function validateBye(entry) {
  const codes = [];
  const playerName = trimPlayerName(entry.playerName);
  if (!playerName) codes.push("playerNameRequired");
  if (isReservedByeName(playerName)) codes.push("byeReservedPlayerName");
  return { valid: codes.length === 0, codes };
}

export function validateMatch(entry) {
  const codes = [];
  const player1Name = trimPlayerName(entry.player1Name);
  const player2Name = trimPlayerName(entry.player2Name);
  const player1Score = toScore(entry.player1Score);
  const player2Score = toScore(entry.player2Score);

  if (!player1Name) codes.push("player1NameRequired");
  if (!player2Name) codes.push("player2NameRequired");
  if (isReservedByeName(player1Name)) codes.push("byeReservedPlayer1Name");
  if (isReservedByeName(player2Name)) codes.push("byeReservedPlayer2Name");
  if (player1Name && player2Name && player1Name === player2Name) codes.push("samePlayerName");
  if (player1Score === null) codes.push("player1ScoreInvalid");
  if (player2Score === null) codes.push("player2ScoreInvalid");
  if (
    player1Score !== null &&
    player2Score !== null &&
    player1Score === player2Score &&
    !(player1Score === 0 || player1Score === 1)
  ) {
    codes.push("drawScoreInvalid");
  }

  return { valid: codes.length === 0, codes };
}

export function isValidRoundEntry(entry) {
  return validateRoundEntry(entry).valid;
}

