import { describe, expect, it } from 'vitest';
import { escapeSearchTerm, highlightSearchText } from './search-highlight';

describe('highlightSearchText', () => {
  it('returns one unhighlighted part for an empty query', () => {
    expect(highlightSearchText('Gones Lyon', '')).toEqual([{ text: 'Gones Lyon', highlighted: false }]);
  });

  it('marks a case-insensitive match', () => {
    const parts = highlightSearchText('Gones Lyon', 'lyon');
    expect(parts.map(part => part.text).join('')).toBe('Gones Lyon');
    expect(parts.filter(part => part.highlighted)).toEqual([{ text: 'Lyon', highlighted: true }]);
  });

  it('ignores diacritics', () => {
    const parts = highlightSearchText('Ligue AURA à Lyon', 'a lyon');
    expect(parts.some(part => part.highlighted)).toBe(true);
    expect(parts.map(part => part.text).join('')).toBe('Ligue AURA à Lyon');
  });

  it('merges overlapping ranges', () => {
    const parts = highlightSearchText('aaaa', 'aa');
    expect(parts.map(part => part.text).join('')).toBe('aaaa');
  });

  // Regression: the highlighter used to split on whitespace only, so a comma-separated query
  // filtered the calendar down to a card and then highlighted nothing in it.
  it('splits on the same separators as the calendar filter', () => {
    const parts = highlightSearchText('Legacy Lyon', 'lyon,legacy');
    expect(parts.map(part => part.text).join('')).toBe('Legacy Lyon');
    expect(parts.filter(part => part.highlighted).map(part => part.text)).toEqual(['Legacy', 'Lyon']);
    expect(highlightSearchText('Legacy Lyon', 'lyon;legacy').filter(part => part.highlighted)).toHaveLength(2);
  });

  it('keeps an escaped separator inside one term', () => {
    const parts = highlightSearchText('Grand Prix Lyon', escapeSearchTerm('Grand Prix'));
    expect(parts.filter(part => part.highlighted).map(part => part.text)).toEqual(['Grand Prix']);
  });

  // The parts are bound as text nodes, never as HTML, so a markup-shaped query stays literal text.
  it('keeps a markup-shaped query as literal text', () => {
    const parts = highlightSearchText('Lyon <img src=x onerror=alert(1)> Legacy', '<img src=x onerror=alert(1)>');
    expect(parts.map(part => part.text).join('')).toBe('Lyon <img src=x onerror=alert(1)> Legacy');
    expect(parts.some(part => part.highlighted && part.text === 'img')).toBe(true);
  });
});
