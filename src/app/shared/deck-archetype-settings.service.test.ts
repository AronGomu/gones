import { beforeEach, describe, expect, it } from 'vitest';
import { DeckArchetypeSettingsService, parseAppSettings } from './deck-archetype-settings.service';

describe('DeckArchetypeSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (_name: string, callback: () => unknown) => Promise.resolve(callback()) }
    });
  });

  it('stores unique archetypes case-insensitively', async () => {
    const service = new DeckArchetypeSettingsService();

    await expect(service.add(' Fire   Control ')).resolves.toBe(true);
    await expect(service.add('fire control')).resolves.toBe(false);

    expect(service.archetypes()).toEqual(['Fire Control']);
  });

  it('prevents editing an archetype into an existing name', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.add('Fire');
    await service.add('Ice');

    await expect(service.update('Fire', 'ice')).resolves.toBe(false);
    expect(service.archetypes()).toEqual(['Fire', 'Ice']);
  });

  it('returns semi-lax fuzzy suggestions for typed text', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.add('Blue Red Tempo');
    await service.add('Mono Green Aggro');
    await service.add('Control');

    expect(service.suggestions('br')).toContain('Blue Red Tempo');
    expect(service.suggestions('green')[0]).toBe('Mono Green Aggro');
  });

  it('stores and exports settings as a JSON object', async () => {
    const service = new DeckArchetypeSettingsService();

    await service.add('Fire Control');

    expect(JSON.parse(localStorage.getItem('gones.settings') ?? 'null')).toEqual({ deckArchetypes: ['Fire Control'] });
    expect(service.exportSettings()).toEqual({ deckArchetypes: ['Fire Control'] });
  });

  it('normalizes imported settings before replacing existing archetypes', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.add('Fire');

    await expect(service.replaceSettings({ deckArchetypes: [' Zoo ', 'zoo', '', 'Blue   Tempo'] })).resolves.toBe(true);

    expect(service.archetypes()).toEqual(['Blue Tempo', 'Zoo']);
    expect(JSON.parse(localStorage.getItem('gones.settings') ?? 'null')).toEqual({ deckArchetypes: ['Blue Tempo', 'Zoo'] });
  });

  it('rejects invalid imported settings without replacing current archetypes', async () => {
    const service = new DeckArchetypeSettingsService();
    await service.add('Fire');

    expect(parseAppSettings({ deckArchetypes: 'Fire' })).toBeNull();
    expect(parseAppSettings({ deckArchetypes: ['Fire', true] })).toBeNull();
    await expect(service.replaceSettings({ deckArchetypes: 'Fire' })).resolves.toBe(false);
    await expect(service.replaceSettings({ deckArchetypes: ['Fire', true] })).resolves.toBe(false);

    expect(service.archetypes()).toEqual(['Fire']);
  });
});
