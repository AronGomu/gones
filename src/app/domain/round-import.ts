import { createInvalidRoundEntry, createMatchRoundEntry, IdFactory, MatchRoundEntry } from './models';

const HEADER = ['table', 'player', 'result', 'opponent', 'player_decklist', 'opponent_decklist'];

export interface ImportResult {
  entries: Array<MatchRoundEntry | ReturnType<typeof createInvalidRoundEntry>>;
}

export interface ParsedResult {
  playerScore: number;
  opponentScore: number;
  outcome: 'won' | 'lost' | 'draw';
}

export function importRoundEntries(text: string, { idFactory }: { idFactory?: IdFactory } = {}): ImportResult {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: ImportResult['entries'] = [];
  let sawHeader = false;
  for (const line of lines) {
    const parsed = parseDelimitedLine(line, ',');
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
    const parsedResult = parseResult(result);
    if (!parsedResult) {
      entries.push(createInvalidRoundEntry({ rawText: line, table, player, result, opponent, playerDecklist, opponentDecklist }, { idFactory }));
      continue;
    }

    entries.push(createMatchRoundEntry({
      table,
      player1Name: player,
      player2Name: opponent,
      player1Score: parsedResult.playerScore,
      player2Score: parsedResult.opponentScore,
      player1DeckArchetype: playerDecklist,
      player2DeckArchetype: opponentDecklist
    }, { idFactory }));
  }

  return { entries };
}

export function parseResult(result: string): ParsedResult | null {
  const match = String(result ?? '').trim().match(/^(won|lost|draw(?:n)?)\s+(\d+)\s*-\s*(\d+)$/i);
  if (!match) return null;
  const outcome = match[1].toLowerCase();
  const playerScore = Number(match[2]);
  const opponentScore = Number(match[3]);
  if (!Number.isInteger(playerScore) || !Number.isInteger(opponentScore)) return null;
  if (outcome === 'won' && playerScore <= opponentScore) return null;
  if (outcome === 'lost' && playerScore >= opponentScore) return null;
  if ((outcome === 'draw' || outcome === 'drawn') && playerScore !== opponentScore) return null;
  return { playerScore, opponentScore, outcome: outcome === 'drawn' ? 'draw' : outcome as ParsedResult['outcome'] };
}

export function parseDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
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
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function isHeader(fields: string[]): boolean {
  return fields.length === HEADER.length && fields.map((field) => field.trim().toLowerCase()).every((field, index) => field === HEADER[index]);
}
