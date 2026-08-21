import { describe, expect, it } from 'vitest';
import { formatRatingDelta, formatRatingValue } from './rating-format';

describe('formatRatingDelta', () => {
  it('returns empty string for zero', () => { expect(formatRatingDelta(0)).toBe(''); });
  it('returns empty string for null', () => { expect(formatRatingDelta(null)).toBe(''); });
  it('returns empty string for undefined', () => { expect(formatRatingDelta(undefined)).toBe(''); });
  it('prefixes positive values with +', () => { expect(formatRatingDelta(28)).toBe('+28'); });
  it('keeps the minus sign for negative values', () => { expect(formatRatingDelta(-13)).toBe('-13'); });
});

describe('formatRatingValue', () => {
  it('returns the number as string when present', () => { expect(formatRatingValue(1524)).toBe('1524'); });
  it('returns em dash for null', () => { expect(formatRatingValue(null)).toBe('—'); });
  it('returns em dash for undefined', () => { expect(formatRatingValue(undefined)).toBe('—'); });
});
