import { describe, expect, it } from 'vitest';
import { registrationDestination } from './registration-gate';

describe('verified-email registration gate', () => {
  it('always sends new local accounts to verification before login', () => {
    expect(registrationDestination({ emailVerified: false })).toBe('/verify-email');
  });
});
