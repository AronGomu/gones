import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error - the dev account roster is a plain ESM module shared with the seeding script.
import { DEV_ACCOUNTS, meetsPasswordPolicy } from '../scripts/dev-accounts.mjs';

/**
 * ADR 0029 local development accounts.
 *
 * `npm run dev` could not sign in: no user row existed, and the local API issued a `Secure` refresh
 * cookie that a plain-http host silently drops. Both halves of the fix live in files rather than in
 * code the app runs, so these assertions are what keeps them from rotting — the credentials still
 * satisfying the server's password policy, and the cookie relaxation staying scoped to the local
 * Compose file.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

interface DevAccount {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  password: string;
}

const accounts = DEV_ACCOUNTS as DevAccount[];
const GLOBAL_ROLES = ['User', 'Organizer', 'Admin'];

describe('dev account credentials', () => {
  it('every dev account password meets the server policy', () => {
    for (const account of accounts) expect(meetsPasswordPolicy(account.password)).toBe(true);
  });

  it('password policy rejects a short or weak password', () => {
    for (const weak of ['short', 'alllowercase1!', 'NOLOWERCASE1!', 'NoDigitsHere!!', 'NoSymbols12345']) {
      expect(meetsPasswordPolicy(weak)).toBe(false);
    }
  });

  it('seeds exactly one Admin and one plain User', () => {
    expect(accounts.map((account) => account.email)).toEqual(['admin@gones.test', 'test@gones.test']);
    expect(accounts.map((account) => account.role)).toEqual(['Admin', 'User']);
  });

  it('every dev account role is an accepted global role', () => {
    for (const account of accounts) expect(GLOBAL_ROLES).toContain(account.role);
  });
});

describe('refresh cookie topology', () => {
  it('local compose relaxes the refresh cookie for plain http', () => {
    const compose = read('compose.yaml');

    expect(compose).toMatch(/GONES__AUTH__REFRESHCOOKIE__SECURE:\s*\$\{GONES__AUTH__REFRESHCOOKIE__SECURE:-false\}/);
    expect(compose).toMatch(/GONES__AUTH__REFRESHCOOKIE__SAMESITE:\s*\$\{GONES__AUTH__REFRESHCOOKIE__SAMESITE:-Lax\}/);
  });

  it('release compose never defaults the cookie insecure', () => {
    for (const file of ['compose.release-candidate.yaml', 'compose.release-test.yaml']) {
      expect(read(file)).not.toContain('REFRESHCOOKIE__SECURE:-false');
    }
  });
});

describe('dev seeding wiring', () => {
  it('npm run dev seeds the dev accounts', () => {
    const dev = read('scripts/dev.mjs');

    expect(dev).toContain('seed-dev-accounts.mjs');
    expect(dev).toContain('--no-accounts');
  });

  it('package.json exposes the seeding script', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    expect(manifest.scripts['dev:accounts']).toBe('node scripts/seed-dev-accounts.mjs');
  });

  it('the seeding script verifies the email and writes the role', () => {
    const seed = read('scripts/seed-dev-accounts.mjs');

    expect(seed).toContain('email_confirmed = true');
    expect(seed).toContain('global_role');
  });
});
