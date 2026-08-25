export type LeagueStatus = 'active' | 'completed';
export interface CalendarEventDocument {
  id: string;
  slug: string;
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  country: string;
  city: string;
  address: string;
  description: string;
  richDescriptionHtml: string;
  externalLink: string;
}

export interface PlayerArchetypeDocument {
  playerName: string;
  archetype: string;
}

export interface RoundDocument {
  id: string;
  entries: RoundEntry[];
}

export type RoundEntry = MatchRoundEntry | ByeRoundEntry | InvalidRoundEntry;

export interface MatchRoundEntry {
  kind: 'match';
  id: string;
  table: string;
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  player1DeckArchetype: string;
  player2DeckArchetype: string;
}

export interface ByeRoundEntry {
  kind: 'bye';
  id: string;
  table: string;
  playerName: string;
  deckArchetype: string;
}

export interface InvalidRoundEntry {
  kind: 'invalid';
  id: string;
  rawText: string;
  table: string;
  player: string;
  result: string;
  opponent: string;
  playerDecklist: string;
  opponentDecklist: string;
}

export type IdFactory = () => string;
type RoundEntryInput = Partial<MatchRoundEntry> | Partial<ByeRoundEntry> | Partial<InvalidRoundEntry>;
type RoundInput = Partial<Omit<RoundDocument, 'entries'>> & { entries?: RoundEntryInput[] };

export function createIdFactory(prefix = 'id'): IdFactory {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

export function defaultIdFactory(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function trimPlayerName(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeLeagueStatus(status: unknown): LeagueStatus {
  return status === 'completed' || status === 'finished' ? 'completed' : 'active';
}

/**
 * Deliberately the opposite default to {@link normalizeLeagueStatus}: an archive document that predates the field
 * is history, and history is complete. Only the literal `'active'` reads active; a missing, null or unknown value
 * reads `'completed'`, the same rule the backfill migration applies to stored documents. A newly created tournament
 * gets its `'active'` at the call site, never here. A League status never cascades — the two flags are independent.
 */
export function normalizeTournamentStatus(status: unknown): LeagueStatus {
  return status === 'active' ? 'active' : 'completed';
}

export function createCalendarEvent(
  { id, slug = '', title = '', eventDate = todayDateString(), startTime = '', endTime = '', location = '', country = '', city = '', address = '', description = '', richDescriptionHtml = '', externalLink = '' }: Partial<CalendarEventDocument> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): CalendarEventDocument {
  const normalizedTitle = String(title ?? '').trim();
  const normalizedCountry = String(country ?? '').trim();
  const normalizedCity = String(city ?? '').trim();
  const normalizedAddress = String(address ?? '').trim();
  const normalizedLocation = String(location || [normalizedAddress, normalizedCity, normalizedCountry].filter(Boolean).join(', ')).trim();
  const normalizedDescription = String(description ?? '').trim();
  return {
    id: id ?? idFactory(),
    slug: normalizeSlug(slug || normalizedTitle),
    title: normalizedTitle,
    eventDate: normalizeDateString(eventDate),
    startTime: normalizeTimeString(startTime),
    endTime: normalizeTimeString(endTime),
    location: normalizedLocation,
    country: normalizedCountry,
    city: normalizedCity,
    address: normalizedAddress,
    description: normalizedDescription,
    richDescriptionHtml: normalizeRichDescriptionHtml(richDescriptionHtml || normalizedDescription),
    externalLink: normalizeExternalLink(externalLink)
  };
}

export function normalizeCalendarEvent(event: Partial<CalendarEventDocument> = {}, options: { idFactory?: IdFactory } = {}): CalendarEventDocument {
  return createCalendarEvent(event, options);
}

export function normalizeCalendarEvents(events: unknown, options: { idFactory?: IdFactory } = {}): CalendarEventDocument[] {
  if (!Array.isArray(events)) return [];
  const slugCounts = new Map<string, number>();
  return events
    .map((event) => normalizeCalendarEvent(event as Partial<CalendarEventDocument>, options))
    .map((event) => ({ ...event, slug: uniqueCalendarEventSlug(event.slug, slugCounts) }))
    .sort((left, right) => compareCalendarEvents(left, right));
}

export function getDefaultTournamentName(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function createRound({ id, entries = [] }: RoundInput = {}, { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}): RoundDocument {
  return { id: id ?? idFactory(), entries: entries.map((entry, index) => createRoundEntry(withDefaultTable(entry, String(index + 1)), { idFactory })) };
}

export function createRoundEntry(entry: RoundEntryInput = {}, { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}): RoundEntry {
  if (entry.kind === 'bye') return createByeRoundEntry(entry, { idFactory });
  if (entry.kind === 'invalid') return createInvalidRoundEntry(entry, { idFactory });
  return createMatchRoundEntry(entry as Partial<MatchRoundEntry>, { idFactory });
}

export function createMatchRoundEntry(
  { id, table = '', player1Name = '', player2Name = '', player1Score = 2, player2Score = 0, player1DeckArchetype = '', player2DeckArchetype = '' }: Partial<MatchRoundEntry> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): MatchRoundEntry {
  return {
    kind: 'match',
    id: id ?? idFactory(),
    table: String(table ?? ''),
    player1Name: trimPlayerName(player1Name),
    player2Name: trimPlayerName(player2Name),
    player1Score: toNonNegativeInteger(player1Score),
    player2Score: toNonNegativeInteger(player2Score),
    player1DeckArchetype: normalizeDeckArchetype(player1DeckArchetype),
    player2DeckArchetype: normalizeDeckArchetype(player2DeckArchetype)
  };
}

export function createByeRoundEntry(
  { id, table = '', playerName = '', deckArchetype = '' }: Partial<ByeRoundEntry> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): ByeRoundEntry {
  return { kind: 'bye', id: id ?? idFactory(), table: String(table ?? ''), playerName: trimPlayerName(playerName), deckArchetype: normalizeDeckArchetype(deckArchetype) };
}

export function createInvalidRoundEntry(
  { id, rawText = '', table = '', player = '', result = '', opponent = '', playerDecklist = '', opponentDecklist = '' }: Partial<InvalidRoundEntry> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): InvalidRoundEntry {
  return {
    kind: 'invalid',
    id: id ?? idFactory(),
    rawText: String(rawText ?? ''),
    table: String(table ?? ''),
    player: trimPlayerName(player),
    result: String(result ?? ''),
    opponent: trimPlayerName(opponent),
    playerDecklist: String(playerDecklist ?? ''),
    opponentDecklist: String(opponentDecklist ?? '')
  };
}

function withDefaultTable(entry: RoundEntryInput, fallbackTable: string): RoundEntryInput {
  if (entry.kind === 'bye') return { ...entry, table: entry.table || fallbackTable };
  if (entry.kind === 'invalid') return { ...entry, table: entry.table || fallbackTable };
  return { ...entry, table: entry.table || fallbackTable };
}

/** Empty string for missing labels. "No archetype" is not a real archetype. */
export function normalizeDeckArchetype(value: unknown): string {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'no archetype') return '';
  return trimmed;
}

export function formatPlayerWithArchetype(playerName: string, archetype: string): string {
  const name = trimPlayerName(playerName);
  const deck = normalizeDeckArchetype(archetype);
  if (!deck || deck.toLowerCase() === 'unknown') return name;
  return `${name} (${deck})`;
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function compareCalendarEvents(left: CalendarEventDocument, right: CalendarEventDocument): number {
  return left.eventDate.localeCompare(right.eventDate) || left.startTime.localeCompare(right.startTime) || left.title.localeCompare(right.title);
}

function uniqueCalendarEventSlug(slug: string, counts: Map<string, number>): string {
  const base = normalizeSlug(slug || 'event');
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

export function normalizeSlug(value: unknown): string {
  const text = String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return text || 'event';
}

function normalizeRichDescriptionHtml(value: unknown): string {
  const html = String(value ?? '').trim();
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeRichNode(template.content);
  return template.innerHTML;
}

function sanitizeRichNode(parent: ParentNode): void {
  const allowedTags = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H2', 'H3', 'A', 'IMG']);
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (!(node instanceof HTMLElement)) {
      node.remove();
      continue;
    }
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes));
      sanitizeRichNode(parent);
      continue;
    }
    const originalHref = node.getAttribute('href');
    const originalSrc = node.getAttribute('src');
    const originalAlt = node.getAttribute('alt');
    for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);
    if (node instanceof HTMLAnchorElement) {
      const href = normalizeExternalLink(originalHref);
      if (href) {
        node.setAttribute('href', href);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (node instanceof HTMLImageElement) {
      const src = normalizeHttpsImageUrl(originalSrc);
      if (!src) {
        node.remove();
        continue;
      }
      node.setAttribute('src', src);
      node.setAttribute('alt', originalAlt ?? '');
      node.setAttribute('loading', 'lazy');
    }
    sanitizeRichNode(node);
  }
}

function normalizeHttpsImageUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function todayDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDateString(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayDateString();
}

function normalizeTimeString(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function normalizeExternalLink(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}
