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

const accounts = readJson<DemoAccount[]>('fixtures/dev-environments/demo/accounts.json');
const organizations = readJson<DemoOrganization[]>('fixtures/dev-environments/demo/organizations.json');
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

  it('lists every demo account exactly once', () => {
    for (const account of accounts) {
      expect(doc.split(`| ${account.email} |`).length - 1, `rows for ${account.email}`).toBe(1);
    }
    expect(doc.split('\n').filter((line) => line.startsWith('| ') && line.includes('@gones.test'))).toHaveLength(accounts.length);
  });

  it('lists the organizations an organizer owns', () => {
    expect(rowFor('organizer@gones.test')).toContain('Gones Lyon');
    expect(rowFor('organizer2@gones.test')).toContain('Ligue AURA');
  });

  it('flags the unverified account', () => {
    const row = rowFor('unverified@gones.test');

    expect(row).toContain('| no |');
    expect(row).toContain('cannot write until the email is verified');
  });

  it('documents the shared password', () => {
    expect(doc).toContain(DEV_PASSWORD);
  });
});
