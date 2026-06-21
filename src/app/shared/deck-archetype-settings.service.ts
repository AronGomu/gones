import { computed, Injectable, signal } from '@angular/core';

const SETTINGS_KEY = 'gones.settings';
const SETTINGS_LANGUAGE_KEY = 'gones.settings.language';
const DECK_ARCHETYPES_KEY = 'gones.settings.deckArchetypes';
const DECK_ARCHETYPES_LOCK_NAME = 'gones.settings.deckArchetypes';

export type SettingsLanguage = 'en' | 'fr';

export interface AppSettingsExport {
  language: SettingsLanguage;
  deckArchetypes: string[];
}

@Injectable({ providedIn: 'root' })
export class DeckArchetypeSettingsService {
  private readonly archetypesSignal = signal(loadDeckArchetypes());
  private readonly languageSignal = signal(loadSettingsLanguage());
  readonly archetypes = computed(() => this.archetypesSignal());
  readonly language = computed(() => this.languageSignal());

  constructor() {
    window.addEventListener('storage', (event) => {
      if (event.key === SETTINGS_KEY || event.key === SETTINGS_LANGUAGE_KEY || event.key === DECK_ARCHETYPES_KEY) this.refreshFromStorage();
    });
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
      writeSettings(settings.deckArchetypes, settings.language);
      this.archetypesSignal.set(settings.deckArchetypes);
      this.languageSignal.set(settings.language);
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
      .map((archetype) => ({ archetype, score: fuzzyScore(archetype, normalizedQuery) }))
      .filter((match) => match.score !== Number.POSITIVE_INFINITY)
      .sort((left, right) => left.score - right.score || left.archetype.localeCompare(right.archetype))
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

export function normalizeArchetypeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function archetypeKey(value: unknown): string {
  return normalizeArchetypeName(value).toLocaleLowerCase();
}

export function normalizeSettingsLanguage(value: unknown): SettingsLanguage | null {
  return value === 'fr' || value === 'en' ? value : null;
}

function loadDeckArchetypes(): string[] {
  const settings = parseStoredSettings();
  if (settings) return settings.deckArchetypes;

  try {
    const parsed = JSON.parse(localStorage.getItem(DECK_ARCHETYPES_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? uniqueArchetypes(parsed.map((item) => String(item ?? ''))) : [];
  } catch {
    return [];
  }
}

function loadSettingsLanguage(): SettingsLanguage {
  const settings = parseStoredSettings();
  if (settings) return settings.language;
  return normalizeSettingsLanguage(localStorage.getItem(SETTINGS_LANGUAGE_KEY)) ?? 'en';
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

function fuzzyScore(archetype: string, normalizedQuery: string): number {
  const candidate = archetypeKey(archetype);
  if (candidate === normalizedQuery) return 0;
  if (candidate.startsWith(normalizedQuery)) return 10 + candidate.length - normalizedQuery.length;
  if (candidate.includes(normalizedQuery)) return 30 + candidate.indexOf(normalizedQuery);

  let queryIndex = 0;
  let firstMatch = -1;
  let gaps = 0;
  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < normalizedQuery.length; candidateIndex++) {
    if (candidate[candidateIndex] !== normalizedQuery[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = candidateIndex;
    gaps += candidateIndex - queryIndex;
    queryIndex++;
  }

  return queryIndex === normalizedQuery.length ? 60 + firstMatch + gaps : Number.POSITIVE_INFINITY;
}
