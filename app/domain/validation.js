import { trimPlayerName } from "./models.js";
import { parseResult } from "./round-import.js";

export function isReservedByeName(value) {
  return trimPlayerName(value).toLowerCase() === "bye";
}

export function toScore(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function entryScores(entry) {
  return parseResult(entry?.result);
}

export function validateRoundEntry(entry) {
  if (!entry || entry.kind === "invalid") return { valid: false, codes: ["invalidRoundEntry"] };
  if (entry.kind === "bye") return validateBye(entry);
  if (entry.kind === "match") return validateMatch(entry);
  return { valid: false, codes: ["unknownRoundEntryKind"] };
}

export function validateBye(entry) {
  const codes = [];
  const player = trimPlayerName(entry.player);
  if (!player) codes.push("playerRequired");
  if (isReservedByeName(player)) codes.push("byeReservedPlayerName");
  return { valid: codes.length === 0, codes };
}

export function validateMatch(entry) {
  const codes = [];
  const player = trimPlayerName(entry.player);
  const opponent = trimPlayerName(entry.opponent);
  if (!player) codes.push("playerRequired");
  if (!opponent) codes.push("opponentRequired");
  if (isReservedByeName(player)) codes.push("byeReservedPlayerName");
  if (isReservedByeName(opponent)) codes.push("byeReservedOpponentName");
  if (player && opponent && player === opponent) codes.push("samePlayerName");
  if (!entryScores(entry)) codes.push("resultInvalid");
  return { valid: codes.length === 0, codes };
}

export function isValidRoundEntry(entry) {
  return validateRoundEntry(entry).valid;
}
