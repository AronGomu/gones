/** Deliberately permissive: one @, a non-empty local part, and a dotted domain. The server is the authority. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MIN_LOGIN_PASSWORD_LENGTH = 3;

export function isValidLoginEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function isValidLoginPassword(value: string): boolean {
  return value.trim().length >= MIN_LOGIN_PASSWORD_LENGTH;
}

export function loginFormIsValid(email: string, password: string): boolean {
  return isValidLoginEmail(email) && isValidLoginPassword(password);
}
