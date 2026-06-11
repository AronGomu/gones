import { DeckArchetypeSettingsService } from './deck-archetype-settings.service';

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
});
