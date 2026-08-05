import { describe, expect, it } from 'vitest';
import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('keeps same-origin in-app paths', () => {
    expect(safeReturnUrl('/calendar', '/profile')).toBe('/calendar');
    expect(safeReturnUrl('/organizer/tournaments/new', '/profile')).toBe('/organizer/tournaments/new');
    expect(safeReturnUrl('/calendar?city=Lyon#results', '/profile')).toBe('/calendar?city=Lyon#results');
  });

  it.each([
    ['//evil.test/steal', 'protocol-relative'],
    ['///evil.test', 'triple slash'],
    ['/\\evil.test', 'backslash after slash'],
    ['\\\\evil.test', 'unc style'],
    ['/\\/evil.test', 'mixed slash'],
    ['https://evil.test', 'absolute https'],
    ['http://evil.test', 'absolute http'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['data:text/html,<script>alert(1)</script>', 'data scheme'],
    ['calendar', 'relative path'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['/calendar\u000aSet-Cookie: a=b', 'newline injection'],
    ['/calendar\u0009x', 'tab'],
    ['/calendar\u0000', 'null byte']
  ])('rejects %s (%s)', (candidate) => {
    expect(safeReturnUrl(candidate, '/profile')).toBe('/profile');
  });

  it('rejects missing values and absurdly long values', () => {
    expect(safeReturnUrl(null, '/profile')).toBe('/profile');
    expect(safeReturnUrl(undefined, '/profile')).toBe('/profile');
    expect(safeReturnUrl(`/${'a'.repeat(4000)}`, '/profile')).toBe('/profile');
  });
});
