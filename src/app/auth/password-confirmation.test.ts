import { describe, expect, it } from 'vitest';
import { passwordConfirmationErrors } from './password-confirmation';

describe('passwordConfirmationErrors', () => {
  it('flags an empty confirmation', () => {
    const result = passwordConfirmationErrors('abcdefghijkl', '');
    expect(result['confirmPassword']).toHaveLength(1);
    expect(Object.keys(result)).toEqual(['confirmPassword']);
  });

  it('flags a mismatch', () => {
    const result = passwordConfirmationErrors('abcdefghijkl', 'abcdefghijkm');
    expect(result['confirmPassword']).toBeDefined();
    expect(result['confirmPassword'].length).toBeGreaterThan(0);
  });

  it('accepts a match', () => {
    expect(passwordConfirmationErrors('abcdefghijkl', 'abcdefghijkl')).toEqual({});
  });
});
