import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import { fieldErrorsFromProblem } from './auth-errors';

describe('auth Problem Details mapping', () => {
  it('normalizes server field names and preserves all messages', () => {
    const error = new ApiProblemError(400, { code: 'validation_failed', errors: { Email: ['Invalid email.'], 'request.Password': ['Too short.', 'Needs a digit.'] } });
    expect(fieldErrorsFromProblem(error)).toEqual({ email: ['Invalid email.'], password: ['Too short.', 'Needs a digit.'] });
  });

  it('returns no field errors for generic failures', () => {
    expect(fieldErrorsFromProblem(new Error('network'))).toEqual({});
  });
});
