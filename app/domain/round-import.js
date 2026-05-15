import { createByeRoundEntry, createInvalidRoundEntry, createMatchRoundEntry } from "./models.js";

const HEADER = ["player_1", "player_2", "player_1_score", "player_2_score"];

export function importRoundEntries(text, { idFactory } = {}) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    const delimiter = chooseDelimiter(line);
    const parsed = parseDelimitedLine(line, delimiter);
    if (parsed.length === 4 && isHeader(parsed)) continue;
    if (parsed.length !== 4) {
      entries.push(createInvalidRoundEntry({ rawText: line }, { idFactory }));
      continue;
    }

    const [player1Name, player2Name, player1Score, player2Score] = parsed.map((field) => field.trim());
    if (player2Name.toLowerCase() === "bye") {
      entries.push(createByeRoundEntry({ playerName: player1Name }, { idFactory }));
      continue;
    }

    entries.push(
      createMatchRoundEntry({ player1Name, player2Name, player1Score, player2Score }, { idFactory })
    );
  }

  return { entries };
}

function chooseDelimiter(line) {
  const commaCount = parseDelimitedLine(line, ",").length;
  const semicolonCount = parseDelimitedLine(line, ";").length;
  return semicolonCount === 4 && commaCount !== 4 ? ";" : ",";
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
  return fields.map((field) => field.trim().toLowerCase()).every((field, index) => field === HEADER[index]);
}

export const testExports = { parseDelimitedLine };

