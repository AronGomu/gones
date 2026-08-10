import { describe, expect, it } from 'vitest';
import { authReturnLink } from './auth-return-link';

describe('authReturnLink', () => {
  it('maps every mode', () => {
    expect(authReturnLink('login')).toEqual(['/']);
    expect(authReturnLink('register')).toEqual(['/']);
    expect(authReturnLink('complete-profile')).toBeNull();
    expect(authReturnLink('verify-email')).toEqual(['/login']);
    expect(authReturnLink('forgot-password')).toEqual(['/login']);
    expect(authReturnLink('reset-password')).toEqual(['/login']);
  });
});
