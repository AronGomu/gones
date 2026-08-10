import { beforeEach, describe, expect, it } from 'vitest';
import { PRESET_LEGACY_ARCHETYPES } from '../config/legacy-archetype-presets';
import { DeckArchetypeSettingsService, fuzzyMatchIndices, parseAppSettings } from './deck-archetype-settings.service';

describe('DeckArchetypeSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (_name: string, callback: () => unknown) => Promise.resolve(callback()) }
    });
  });

  it('always loads bundled Legacy presets into settings and autocomplete', () => {
    const service = new DeckArchetypeSettingsService();
    expect(service.archetypes()).toHaveLength(PRESET_LEGACY_ARCHETYPES.length);
    expect(service.archetypes()).toContain('Reanimator (Rakdos)');
    expect(service.archetypes()).toContain('Tempo (Dimir)');
    expect(service.suggestions('rean')).toContain('Reanimator (Rakdos)');
    expect(service.has('Lands (Gruul)')).toBe(true);
    expect(JSON.parse(localStorage.getItem('gones.settings') ?? 'null').deckArchetypes).toContain('Reanimator (Rakdos)');
  });

  it('keeps custom archetypes while ensuring presets remain', () => {
    localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: ['House Brew'] }));
    const service = new DeckArchetypeSettingsService();
    expect(service.archetypes()).toContain('House Brew');
    expect(service.archetypes()).toContain('Reanimator (Rakdos)');
    expect(service.archetypes().length).toBe(PRESET_LEGACY_ARCHETYPES.length + 1);
  });

  it('re-applies baseline presets after an empty replace', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.replaceSettings({ language: 'fr', deckArchetypes: [] });
    expect(service.archetypes()).toContain('Reanimator (Rakdos)');
    expect(service.archetypes().length).toBe(PRESET_LEGACY_ARCHETYPES.length);
  });

  it('stores unique archetypes case-insensitively', async () => {
    const service = new DeckArchetypeSettingsService();
    await expect(service.add(' Fire   Control ')).resolves.toBe(true);
    await expect(service.add('fire control')).resolves.toBe(false);
    expect(service.archetypes()).toContain('Fire Control');
  });

  it('prevents editing an archetype into an existing name', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.add('Fire');
    await service.add('Ice');
    await expect(service.update('Fire', 'ice')).resolves.toBe(false);
    expect(service.archetypes()).toContain('Fire');
    expect(service.archetypes()).toContain('Ice');
  });

  it('returns semi-lax fuzzy suggestions for typed text', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.add('Blue Red Tempo');
    await service.add('Mono Green Aggro');
    expect(service.suggestions('br')).toContain('Blue Red Tempo');
    expect(service.suggestions('green')[0]).toBe('Mono Green Aggro');
  });

  it('returns fuzzy match indices for highlighted autocomplete text', () => {
    expect(fuzzyMatchIndices('Blue Red Tempo', 'br')).toEqual([0, 5]);
    expect(fuzzyMatchIndices('Mono Green Aggro', 'green')).toEqual([5, 6, 7, 8, 9]);
    expect(fuzzyMatchIndices('Control', 'zz')).toEqual([]);
  });

  it('exports settings including baseline presets', () => {
    const service = new DeckArchetypeSettingsService();
    const exported = service.exportSettings();
    expect(exported.language).toBe('fr');
    expect(exported.deckArchetypes).toContain('Reanimator (Rakdos)');
    expect(exported.deckArchetypes.length).toBe(PRESET_LEGACY_ARCHETYPES.length);
  });

  it('normalizes imported settings and still keeps baseline presets', async () => {
    const service = new DeckArchetypeSettingsService();
    await expect(service.replaceSettings({ language: 'fr', deckArchetypes: [' Zoo ', 'zoo', '', 'Blue   Tempo'] })).resolves.toBe(true);
    expect(service.currentLanguage()).toBe('fr');
    expect(service.archetypes()).toContain('Blue Tempo');
    expect(service.archetypes()).toContain('Zoo');
    expect(service.archetypes()).toContain('Reanimator (Rakdos)');
  });

  it('rejects invalid imported settings without replacing current archetypes', async () => {
    const service = new DeckArchetypeSettingsService();
    const before = service.archetypes();
    expect(parseAppSettings({ deckArchetypes: 'Fire' })).toBeNull();
    await expect(service.replaceSettings({ deckArchetypes: 'Fire' })).resolves.toBe(false);
    await expect(service.replaceSettings({ language: 'de', deckArchetypes: ['Fire'] })).resolves.toBe(false);
    expect(service.archetypes()).toEqual(before);
  });

  it('the server catalog replaces the local one', async () => {
    // ADR 0031 / ADR 0032: on sign-in the server list wins outright — replace, never merge.
    localStorage.setItem('gones.settings', JSON.stringify({ language: 'fr', deckArchetypes: ['Local Only'] }));
    const service = new DeckArchetypeSettingsService();

    await expect(service.adoptServerCatalog(['Server A', 'Server B'])).resolves.toBe(true);

    expect(service.archetypes()).toContain('Server A');
    expect(service.archetypes()).toContain('Server B');
    expect(service.archetypes()).not.toContain('Local Only');
    expect(service.archetypes()).toContain('Reanimator (Rakdos)');
    expect(JSON.parse(localStorage.getItem('gones.settings') ?? 'null').deckArchetypes).toEqual(service.archetypes());
  });

  it('adopting the server catalog keeps the language', async () => {
    localStorage.setItem('gones.settings', JSON.stringify({ language: 'fr', deckArchetypes: ['Local Only'] }));
    const service = new DeckArchetypeSettingsService();

    await service.adoptServerCatalog(['Server A']);

    expect(service.currentLanguage()).toBe('fr');
    expect(localStorage.getItem('gones.settings.language')).toBe('fr');
  });

  it('adopting an empty server catalog still erases the local additions', async () => {
    localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: ['Local Only'] }));
    const service = new DeckArchetypeSettingsService();

    await service.adoptServerCatalog([]);

    expect(service.archetypes()).not.toContain('Local Only');
    expect(service.archetypes().length).toBe(PRESET_LEGACY_ARCHETYPES.length);
  });

  it('persists language changes without dropping archetypes', async () => {
    const service = new DeckArchetypeSettingsService();
    await expect(service.setLanguage('en')).resolves.toBe(true);
    expect(service.currentLanguage()).toBe('en');
    expect(service.archetypes()).toContain('Reanimator (Rakdos)');
  });
});
