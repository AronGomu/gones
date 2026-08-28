import { ApiProblemError } from '../api/api-boundary';

export type AuthFieldErrors = Record<string, string[]>;

export function fieldErrorsFromProblem(error: unknown): AuthFieldErrors {
  if (!(error instanceof ApiProblemError) || !error.problem.errors) return {};
  return Object.fromEntries(Object.entries(error.problem.errors).map(([key, messages]) => {
    const name = key.split('.').at(-1) ?? key;
    return [name.charAt(0).toLowerCase() + name.slice(1), messages];
  }));
}
