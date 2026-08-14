import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error - the doc generator is a plain ESM script shared with `npm run docs:demo-accounts`.
import { renderDemoAccountsDoc } from '../scripts/generate-demo-accounts-doc.mjs';
// @ts-expect-error - the dev account roster is a plain ESM module shared with the seeding script.
import { DEV_PASSWORD } from '../scripts/dev-accounts.mjs';

/**
 * `DEMO_ACCOUNTS.md` is generated from the demo fixtures, so it can rot in exactly one way: a
 * fixture changes and nobody re-runs the script. These assertions are that gate — the committed
 * file has to be byte-identical to what the generator produces from the fixtures on disk.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const readJson = <T>(file: string): T => JSON.parse(read(file)) as T;

interface DemoAccount {
  email: string;
  username: string;
  role: string;
  emailConfirmed?: boolean;
}

interface DemoOrganization {
  key: string;
  name: string;
  ownerEmail: string;
}

interface DemoRegistration {
  tournamentKey: string;
  userEmail: string;
}

const expectedRoster = [
  'admin-empty@gones.test',
  'organizer-gones-one-registration@gones.test',
  'organizer-aura-live-standings@gones.test',
  'user-four-registrations@gones.test',
  'user-two-registrations@gones.test',
  'user-empty@gones.test',
  'user-unverified@gones.test'
];
const accounts = readJson<DemoAccount[]>('fixtures/dev-environments/demo/accounts.json');
const organizations = readJson<DemoOrganization[]>('fixtures/dev-environments/demo/organizations.json');
const registrations = readJson<DemoRegistration[]>('fixtures/dev-environments/demo/registrations.json');
const doc = read('DEMO_ACCOUNTS.md');
const rowFor = (email: string): string =>
  doc.split('\n').find((line) => line.startsWith(`| ${email} |`)) ?? `no row for ${email}`;

describe('DEMO_ACCOUNTS.md', () => {
  it('matches the fixtures', () => {
    expect(
      doc,
      'DEMO_ACCOUNTS.md is out of date: re-run `npm run docs:demo-accounts` and commit the result.'
    ).toBe(renderDemoAccountsDoc(accounts, organizations, DEV_PASSWORD));
  });

  it('lists the exact purpose roster once with literal usernames', () => {
    expect(accounts.map((account) => account.email)).toEqual(expectedRoster);
    expect(accounts.map((account) => account.username)).toEqual(expectedRoster.map((email) => email.split('@')[0]));
    for (const account of accounts) {
      expect(doc.split(`| ${account.email} |`).length - 1, `rows for ${account.email}`).toBe(1);
    }
    expect(doc.split('\n').filter((line) => line.startsWith('| ') && line.includes('@gones.test'))).toHaveLength(accounts.length);
  });

  it('lists the organizations each purpose organizer owns', () => {
    expect(rowFor('organizer-gones-one-registration@gones.test')).toContain('Gones Lyon');
    expect(rowFor('organizer-aura-live-standings@gones.test')).toContain('Ligue AURA');
  });

  it('flags only the purpose unverified account', () => {
    const row = rowFor('user-unverified@gones.test');

    expect(accounts.filter((account) => account.emailConfirmed === false).map((account) => account.email)).toEqual(['user-unverified@gones.test']);
    expect(row).toContain('| no |');
    expect(row).toContain('cannot write until the email is verified');
  });

  it('matches registration-purpose account counts', () => {
    const count = (email: string): number => registrations.filter((registration) => registration.userEmail === email).length;

    expect(count('organizer-gones-one-registration@gones.test')).toBe(1);
    expect(count('organizer-aura-live-standings@gones.test')).toBe(0);
    expect(count('user-four-registrations@gones.test')).toBe(4);
    expect(count('user-two-registrations@gones.test')).toBe(2);
    expect(count('user-empty@gones.test')).toBe(0);
    expect(count('user-unverified@gones.test')).toBe(0);
    expect(registrations).toContainEqual({
      tournamentKey: 'aura-spring-classic-legacy',
      userEmail: 'organizer-gones-one-registration@gones.test'
    });
  });

  it('documents the shared password', () => {
    expect(doc).toContain(DEV_PASSWORD);
  });
});
