import { MatchRoundEntry, RoundEntry, trimPlayerName } from './models';

export interface ValidationResult {
  valid: boolean;
  codes: string[];
}

export function isReservedByeName(value: unknown): boolean {
  return trimPlayerName(value).toLowerCase() === 'bye';
}

export function validateRoundEntry(entry: RoundEntry | null | undefined): ValidationResult {
  if (!entry || entry.kind === 'invalid') return { valid: false, codes: ['invalidRoundEntry'] };
  if (entry.kind === 'bye') {
    const codes: string[] = [];
    if (!trimPlayerName(entry.playerName)) codes.push('playerRequired');
    if (isReservedByeName(entry.playerName)) codes.push('byeReservedPlayerName');
    return { valid: codes.length === 0, codes };
  }
  return validateMatch(entry);
}

export function validateMatch(entry: MatchRoundEntry): ValidationResult {
  const codes: string[] = [];
  const player1 = trimPlayerName(entry.player1Name);
  const player2 = trimPlayerName(entry.player2Name);
  if (!player1) codes.push('playerRequired');
  if (!player2) codes.push('opponentRequired');
  if (isReservedByeName(player1)) codes.push('byeReservedPlayerName');
  if (isReservedByeName(player2)) codes.push('byeReservedOpponentName');
  if (player1 && player2 && player1 === player2) codes.push('samePlayerName');
  const player1Score = Number(entry.player1Score);
  const player2Score = Number(entry.player2Score);
  if (!Number.isInteger(player1Score) || player1Score < 0 || !Number.isInteger(player2Score) || player2Score < 0) codes.push('resultInvalid');
  if (Number.isInteger(player1Score) && player1Score > 2) codes.push('resultTooManyGameWins');
  if (Number.isInteger(player2Score) && player2Score > 2) codes.push('resultTooManyGameLosses');
  return { valid: codes.length === 0, codes };
}
