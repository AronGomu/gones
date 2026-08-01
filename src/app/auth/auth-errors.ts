import { ApiProblemError } from '../api/api-boundary';

export type AuthFieldErrors = Record<string, string[]>;

export function fieldErrorsFromProblem(error: unknown): AuthFieldErrors {
  if (!(error instanceof ApiProblemError) || !error.problem.errors) return {};
  return Object.fromEntries(Object.entries(error.problem.errors).map(([key, messages]) => {
    const name = key.split('.').at(-1) ?? key;
    return [name.charAt(0).toLowerCase() + name.slice(1), messages];
  }));
}

export function genericAuthError(error: unknown): string {
  if (error instanceof ApiProblemError) {
    if (error.status === 429) return 'Too many attempts. Wait, then retry.';
    if (error.status === 401) return 'Email or password is incorrect.';
  }
  return 'Request failed. Check your details, then retry.';
}
