export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export function highlightSearchText(text: string, query: string): HighlightPart[] {
  const words = searchWords(query);
  if (!words.length) return [{ text, highlighted: false }];

  const indexed = normalizeSearchTextWithIndex(text);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const word of words) {
    let index = indexed.normalized.indexOf(word);
    while (index !== -1) {
      ranges.push({ start: indexed.originalIndexes[index], end: indexed.originalIndexes[index + word.length - 1] + 1 });
      index = indexed.normalized.indexOf(word, index + 1);
    }
  }

  if (!ranges.length) return [{ text, highlighted: false }];
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = ranges.reduce<Array<{ start: number; end: number }>>((acc, range) => {
    const previous = acc.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else acc.push({ ...range });
    return acc;
  }, []);

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (cursor < range.start) parts.push({ text: text.slice(cursor, range.start), highlighted: false });
    parts.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}

export function searchWords(query: string): string[] {
  return parseSearchTerms(query).map(normalizeSearchText).filter(Boolean);
}

function parseSearchTerms(query: string): string[] {
  const terms: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === '"') {
      if (quoted) {
        if (current.trim()) terms.push(current.trim());
        current = '';
        quoted = false;
      } else {
        if (current.trim()) terms.push(current.trim());
        current = '';
        quoted = true;
      }
      continue;
    }

    if (!quoted && /\s/.test(char)) {
      if (current.trim()) terms.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) terms.push(current.trim());
  return terms;
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeSearchTextWithIndex(value: string): { normalized: string; originalIndexes: number[] } {
  let normalized = '';
  const originalIndexes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = normalizeSearchText(value[index]);
    if (!char) continue;
    normalized += char;
    for (let offset = 0; offset < char.length; offset += 1) originalIndexes.push(index);
  }
  return { normalized, originalIndexes };
}
