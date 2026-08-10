import { describe, expect, it } from 'vitest';

// @ts-expect-error - the dev account roster is a plain ESM module shared with the seeding script.
import { DEV_PASSWORD, meetsPasswordPolicy } from '../scripts/dev-accounts.mjs';
// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { DATA_FILES, listEnvironmentNames, parseDevArgs, readEnvironment, validateEnvironment } from '../scripts/dev-environments.mjs';

/**
 * ADR 0030 file-driven local development environments.
 *
 * The fixtures under `fixtures/dev-environments/` are edited by hand and only read thirty seconds
 * into a Docker reset, so a typo there would surface at the worst possible moment. Running the same
 * `validateEnvironment` the seeder runs over every shipped environment inside `npm run test` is what
 * moves that failure back into the normal test gate.
 */

interface DevEnvironmentAccount {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  password?: string;
  emailConfirmed?: boolean;
}

interface DevEnvironment {
  name: string;
  description: string;
  resetDatabase: boolean;
  accounts: DevEnvironmentAccount[];
  [key: string]: unknown;
}

const names = listEnvironmentNames() as string[];
const dataFiles = DATA_FILES as string[];
const read = (name: string): DevEnvironment => readEnvironment(name) as DevEnvironment;

describe('shipped development environments', () => {
  it('every shipped environment validates', () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(validateEnvironment(read(name)), name).toEqual([]);
  });

  it('the empty environment seeds nothing', () => {
    const environment = read('empty');

    expect(environment.resetDatabase).toBe(false);
    for (const file of dataFiles) expect(environment[file], file).toEqual([]);
  });

  it('the minimal environment carries one account per role', () => {
    const accounts = read('minimal').accounts;

    expect(accounts).toHaveLength(3);
    expect(new Set(accounts.map((account) => account.role))).toEqual(new Set(['User', 'Organizer', 'Admin']));
  });

  it('every fixture password meets the server policy', () => {
    for (const name of names) {
      for (const account of read(name).accounts) {
        expect(meetsPasswordPolicy(account.password ?? DEV_PASSWORD), `${name}/${account.email}`).toBe(true);
      }
    }
  });

  it('an unknown environment is refused', () => {
    expect(() => readEnvironment('does-not-exist')).toThrowError('unknownDevEnvironment');
  });
});

describe('dev argument parsing', () => {
  it('parseDevArgs keeps --env out of the ng arguments', () => {
    const parsed = parseDevArgs(['--env=demo', '--port', '4300', '--no-docker']);

    expect(parsed.environment).toBe('demo');
    expect(parsed.skipDocker).toBe(true);
    expect(parsed.ngArgs).toEqual(['--port', '4300']);
  });
});

describe('environment validation', () => {
  it('validateEnvironment rejects a data-carrying environment that does not reset', () => {
    const problems = validateEnvironment({
      name: 'x',
      description: 'x',
      resetDatabase: false,
      accounts: [{ email: 'x@gones.test', username: 'x', firstName: 'X', lastName: 'X', role: 'User', password: DEV_PASSWORD }],
      organizations: [],
      formats: [],
      tournaments: [],
      registrations: [],
      leagues: [],
      liveTournaments: []
    }) as string[];

    expect(problems).toContain('x: resetDatabase=false but the environment carries data');
  });
});
