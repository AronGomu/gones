import { computed, Injectable, signal } from '@angular/core';
import { PRESET_LEGACY_ARCHETYPES } from '../config/legacy-archetype-presets';

const SETTINGS_KEY = 'gones.settings';
const SETTINGS_LANGUAGE_KEY = 'gones.settings.language';
const DECK_ARCHETYPES_KEY = 'gones.settings.deckArchetypes';
const DECK_ARCHETYPES_LOCK_NAME = 'gones.settings.deckArchetypes';

export type SettingsLanguage = 'en' | 'fr';

export interface AppSettingsExport {
  language: SettingsLanguage;
  deckArchetypes: string[];
}

interface FuzzyMatch {
  score: number;
  indices: number[];
}

@Injectable({ providedIn: 'root' })
export class DeckArchetypeSettingsService {
  private readonly archetypesSignal = signal<string[]>([]);
  private readonly languageSignal = signal<SettingsLanguage>('fr');
  readonly archetypes = computed(() => this.archetypesSignal());
  readonly language = computed(() => this.languageSignal());

  constructor() {
    this.bootstrapFromStorage();
    window.addEventListener('storage', (event) => {
      if (event.key === SETTINGS_KEY || event.key === SETTINGS_LANGUAGE_KEY || event.key === DECK_ARCHETYPES_KEY) this.refreshFromStorage();
    });
  }

  /** Re-read storage and ensure bundled Legacy presets are present. */
  bootstrapFromStorage(): void {
    this.languageSignal.set(loadSettingsLanguage());
    this.archetypesSignal.set(loadDeckArchetypes());
  }

  has(name: string): boolean {
    const key = archetypeKey(name);
    return !!key && this.archetypesSignal().some((archetype) => archetypeKey(archetype) === key);
  }

  currentLanguage(): SettingsLanguage {
    return this.languageSignal();
  }

  exportSettings(): AppSettingsExport {
    return { language: this.languageSignal(), deckArchetypes: [...this.archetypesSignal()] };
  }

  async replaceSettings(value: unknown): Promise<boolean> {
    const settings = parseAppSettings(value);
    if (!settings) return false;

    return this.runExclusive(() => {
      // Import/replace is authoritative for that moment; next bootstrap still re-applies baseline presets.
      const next = uniqueArchetypes([...PRESET_LEGACY_ARCHETYPES, ...settings.deckArchetypes]);
      writeSettings(next, settings.language);
      this.archetypesSignal.set(next);
      this.languageSignal.set(settings.language);
      return true;
    });
  }

  /**
   * The server catalog is authoritative the moment a session exists (ADR 0031): the browser list is
   * replaced, not merged, and nothing local is ever uploaded. A failed fetch changes nothing — an
   * offline sign-in keeps whatever this browser already had.
   */
  async adoptServerCatalog(names: string[]): Promise<boolean> {
    return this.runExclusive(() => {
      // The bundled presets stay: `loadDeckArchetypes()` re-merges them on every read, so dropping
      // them here would only make the next read disagree with this write.
      const next = uniqueArchetypes([...PRESET_LEGACY_ARCHETYPES, ...names]);
      writeSettings(next, this.languageSignal());
      this.archetypesSignal.set(next);
      return true;
    });
  }

  async setLanguage(value: string): Promise<boolean> {
    const language = normalizeSettingsLanguage(value);
    if (!language) return false;

    return this.runExclusive(() => {
      writeSettings(loadDeckArchetypes(), language);
      this.languageSignal.set(language);
      return true;
    });
  }

  async add(name: string): Promise<boolean> {
    const archetype = normalizeArchetypeName(name);
    if (!archetype) return false;
    return this.commit((archetypes) => {
      if (archetypes.some((item) => archetypeKey(item) === archetypeKey(archetype))) return null;
      return [...archetypes, archetype];
    });
  }

  /** Merge imported names into catalog — only adds missing archetypes. */
  async mergeArchetypes(value: unknown): Promise<{ added: number; skipped: number; total: number } | null> {
    const incoming = parseArchetypeImportList(value);
    if (!incoming) return null;

    return this.runExclusive(() => {
      const latest = loadDeckArchetypes();
      const existingKeys = new Set(latest.map((item) => archetypeKey(item)));
      let added = 0;
      let skipped = 0;
      const merged = [...latest];
      for (const name of incoming) {
        const key = archetypeKey(name);
        if (!key) continue;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        existingKeys.add(key);
        merged.push(name);
        added += 1;
      }
      const next = uniqueArchetypes(merged);
      this.archetypesSignal.set(next);
      writeSettings(next, this.languageSignal());
      return { added, skipped, total: next.length };
    });
  }

  async update(previousName: string, nextName: string): Promise<boolean> {
    const previousKey = archetypeKey(previousName);
    const nextArchetype = normalizeArchetypeName(nextName);
    const nextKey = archetypeKey(nextArchetype);
    if (!previousKey || !nextKey) return false;

    return this.commit((archetypes) => {
      if (!archetypes.some((archetype) => archetypeKey(archetype) === previousKey)) return null;
      if (previousKey !== nextKey && archetypes.some((archetype) => archetypeKey(archetype) === nextKey)) return null;
      return archetypes.map((archetype) => archetypeKey(archetype) === previousKey ? nextArchetype : archetype);
    });
  }

  async remove(name: string): Promise<void> {
    const key = archetypeKey(name);
    if (!key) return;
    await this.commit((archetypes) => archetypes.filter((archetype) => archetypeKey(archetype) !== key));
  }

  suggestions(query: string, limit = 8): string[] {
    const normalizedQuery = archetypeKey(query);
    const archetypes = this.archetypesSignal();
    if (!normalizedQuery) return archetypes.slice(0, limit);

    return archetypes
      .map((archetype) => ({ archetype, match: fuzzyMatch(archetype, normalizedQuery) }))
      .filter((match) => match.match.score !== Number.POSITIVE_INFINITY)
      .sort((left, right) => left.match.score - right.match.score || left.archetype.localeCompare(right.archetype))
      .slice(0, limit)
      .map((match) => match.archetype);
  }

  private async commit(updater: (archetypes: string[]) => string[] | null): Promise<boolean> {
    return this.runExclusive(() => this.commitUnlocked(updater));
  }

  private runExclusive<T>(action: () => T): Promise<T> {
    if (!navigator.locks) return Promise.resolve(action());
    return navigator.locks.request(DECK_ARCHETYPES_LOCK_NAME, action);
  }

  private commitUnlocked(updater: (archetypes: string[]) => string[] | null): boolean {
    const latest = loadDeckArchetypes();
    const updated = updater(latest);
    if (!updated) {
      this.archetypesSignal.set(latest);
      return false;
    }
    const next = uniqueArchetypes(updated);
    this.archetypesSignal.set(next);
    writeSettings(next, this.languageSignal());
    return true;
  }

  private refreshFromStorage(): void {
    this.archetypesSignal.set(loadDeckArchetypes());
    this.languageSignal.set(loadSettingsLanguage());
  }
}

export function parseAppSettings(value: unknown): AppSettingsExport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const deckArchetypes = record['deckArchetypes'];
  const language = record['language'] === undefined ? 'en' : normalizeSettingsLanguage(record['language']);
  if (!language || !Array.isArray(deckArchetypes) || !deckArchetypes.every((item) => typeof item === 'string')) return null;
  return { language, deckArchetypes: uniqueArchetypes(deckArchetypes) };
}

/** Accept pure string[], `{ deckArchetypes }`, `{ archetypes }`, or full settings export. */
export function parseArchetypeImportList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string')) return null;
    return uniqueArchetypes(value);
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const list = record['deckArchetypes'] ?? record['archetypes'];
  if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) return null;
  return uniqueArchetypes(list);
}

export function normalizeArchetypeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function archetypeKey(value: unknown): string {
  return normalizeArchetypeName(value).toLocaleLowerCase();
}

export function normalizeSettingsLanguage(value: unknown): SettingsLanguage | null {
  return value === 'fr' || value === 'en' ? value : null;
}

export function fuzzyMatchIndices(archetype: string, query: string): number[] {
  const normalizedQuery = archetypeKey(query);
  if (!normalizedQuery) return [];
  const match = fuzzyMatch(archetype, normalizedQuery);
  return match.score === Number.POSITIVE_INFINITY ? [] : match.indices;
}

function loadDeckArchetypes(): string[] {
  const language = loadSettingsLanguage();
  const existing = readStoredArchetypes() ?? [];
  // Baseline pack is always part of the catalog (custom names kept on top).
  const merged = uniqueArchetypes([...PRESET_LEGACY_ARCHETYPES, ...existing]);
  if (merged.length !== existing.length || !listsEqual(existing, merged)) {
    writeSettings(merged, language);
  }
  return merged;
}

function listsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readStoredArchetypes(): string[] | null {
  const settings = parseStoredSettings();
  if (settings) return settings.deckArchetypes;

  const legacyRaw = localStorage.getItem(DECK_ARCHETYPES_KEY);
  if (legacyRaw == null) return null;
  try {
    const parsed = JSON.parse(legacyRaw) as unknown;
    return Array.isArray(parsed) ? uniqueArchetypes(parsed.map((item) => String(item ?? ''))) : [];
  } catch {
    return [];
  }
}

function loadSettingsLanguage(): SettingsLanguage {
  const settings = parseStoredSettings();
  if (settings) return settings.language;
  return normalizeSettingsLanguage(localStorage.getItem(SETTINGS_LANGUAGE_KEY)) ?? 'fr';
}

function parseStoredSettings(): AppSettingsExport | null {
  try {
    return parseAppSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

function writeSettings(archetypes: string[], language: SettingsLanguage): void {
  const settings = { language, deckArchetypes: uniqueArchetypes(archetypes) } satisfies AppSettingsExport;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem(SETTINGS_LANGUAGE_KEY, settings.language);
  localStorage.setItem(DECK_ARCHETYPES_KEY, JSON.stringify(settings.deckArchetypes));
}

function uniqueArchetypes(values: string[]): string[] {
  const seen = new Set<string>();
  const archetypes: string[] = [];
  for (const value of values) {
    const archetype = normalizeArchetypeName(value);
    const key = archetypeKey(archetype);
    if (!archetype || seen.has(key)) continue;
    seen.add(key);
    archetypes.push(archetype);
  }
  return archetypes.sort((left, right) => left.localeCompare(right));
}

function fuzzyMatch(archetype: string, normalizedQuery: string): FuzzyMatch {
  const candidate = archetypeKey(archetype);
  if (candidate === normalizedQuery) return { score: 0, indices: [...candidate].map((_character, index) => index) };
  if (candidate.startsWith(normalizedQuery)) return { score: 10 + candidate.length - normalizedQuery.length, indices: range(normalizedQuery.length) };
  const includesIndex = candidate.indexOf(normalizedQuery);
  if (includesIndex !== -1) return { score: 30 + includesIndex, indices: range(normalizedQuery.length, includesIndex) };

  let queryIndex = 0;
  let firstMatch = -1;
  let gaps = 0;
  const indices: number[] = [];
  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < normalizedQuery.length; candidateIndex++) {
    if (candidate[candidateIndex] !== normalizedQuery[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = candidateIndex;
    gaps += candidateIndex - queryIndex;
    indices.push(candidateIndex);
    queryIndex++;
  }

  return queryIndex === normalizedQuery.length ? { score: 60 + firstMatch + gaps, indices } : { score: Number.POSITIVE_INFINITY, indices: [] };
}

function range(length: number, start = 0): number[] {
  return Array.from({ length }, (_item, index) => start + index);
}
