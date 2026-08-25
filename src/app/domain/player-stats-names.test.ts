import { describe, expect, it } from 'vitest';
import { suggestPlayerNames } from './player-stats';

describe('player name suggestions', () => {
  it('suggests by prefix, excludes registered names, and lists all when query empty', () => {
    const names = ['Alice', 'Alicia', 'Bob', 'Carol'];
    expect(suggestPlayerNames(names, 'ali', { exclude: ['Alice'] })).toEqual(['Alicia']);
    expect(suggestPlayerNames(names, '')).toEqual(['Alice', 'Alicia', 'Bob', 'Carol']);
    expect(suggestPlayerNames(names, '', { limit: 2 })).toEqual(['Alice', 'Alicia']);
  });
});
