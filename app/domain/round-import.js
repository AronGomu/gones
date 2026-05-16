import { createInvalidRoundEntry, createMatchRoundEntry } from "./models.js";

const HEADER = ["table", "player", "result", "opponent", "player_decklist", "opponent_decklist"];

export function importRoundEntries(text, { idFactory } = {}) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let sawHeader = false;
  for (const line of lines) {
    const parsed = parseDelimitedLine(line, ",");
    if (!sawHeader) {
      if (isHeader(parsed)) {
        sawHeader = true;
        continue;
      }
      entries.push(createInvalidRoundEntry({ rawText: line }, { idFactory }));
      continue;
    }

    if (parsed.length !== 6) {
      entries.push(createInvalidRoundEntry({ rawText: line }, { idFactory }));
      continue;
    }

    const [table, player, result, opponent, playerDecklist, opponentDecklist] = parsed.map((field) => field.trim());
    if (!parseResult(result)) {
      entries.push(createInvalidRoundEntry({ rawText: line, table, player, result, opponent, playerDecklist, opponentDecklist }, { idFactory }));
      continue;
    }
    entries.push(createMatchRoundEntry({ table, player, result, opponent, playerDecklist, opponentDecklist }, { idFactory }));
  }

  return { entries };
}

export function parseResult(result) {
  const match = String(result ?? "").trim().match(/^(won|lost|draw(?:n)?)\s+(\d+)\s*-\s*(\d+)$/i);
  if (!match) return null;
  const outcome = match[1].toLowerCase();
  const playerScore = Number(match[2]);
  const opponentScore = Number(match[3]);
  if (!Number.isInteger(playerScore) || !Number.isInteger(opponentScore)) return null;
  if (outcome === "won" && playerScore <= opponentScore) return null;
  if (outcome === "lost" && playerScore >= opponentScore) return null;
  if ((outcome === "draw" || outcome === "drawn") && playerScore !== opponentScore) return null;
  return { playerScore, opponentScore, outcome };
}

function parseDelimitedLine(line, delimiter) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function isHeader(fields) {
  return fields.map((field) => field.trim().toLowerCase()).every((field, index) => field === HEADER[index]) && fields.length === HEADER.length;
}

export const testExports = { parseDelimitedLine };
