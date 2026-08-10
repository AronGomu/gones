/**
 * The fixed local development accounts (ADR 0029).
 *
 * Declared once, here, so the seeding script, the tests and the documentation cannot drift apart.
 * These credentials are public and exist only in the local Compose database.
 */
export const DEV_PASSWORD = 'Gones-dev-pass-123!';

export const DEV_ACCOUNTS = [
  { email: 'admin@gones.test', username: 'gones-admin', firstName: 'Gones', lastName: 'Admin', role: 'Admin', password: DEV_PASSWORD },
  { email: 'test@gones.test', username: 'gones-test', firstName: 'Gones', lastName: 'Test', role: 'User', password: DEV_PASSWORD }
];

/** The server's own registration policy: 12+ characters, mixed case, a digit and a symbol. */
export function meetsPasswordPolicy(password) {
  return typeof password === 'string'
    && password.length >= 12
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}
