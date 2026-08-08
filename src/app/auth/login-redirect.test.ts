import { describe, expect, it } from 'vitest';
import { loginDestination } from './last-visited-url.service';

describe('loginDestination', () => {
  it('returnUrl wins', () => {
    expect(loginDestination('/registrations', '/calendar')).toBe('/registrations');
  });

  it('falls back to last visited', () => {
    expect(loginDestination(null, '/calendar')).toBe('/calendar');
  });

  it('falls back to home', () => {
    expect(loginDestination(null, '')).toBe('/');
  });

  it('rejects an off-site returnUrl', () => {
    expect(loginDestination('https://evil.test', '/calendar')).toBe('/calendar');
  });
});
