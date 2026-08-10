import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error - the dev account roster is a plain ESM module shared with the seeding script.
import { DEV_PASSWORD, meetsPasswordPolicy } from '../scripts/dev-accounts.mjs';
// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { DATA_FILES, isLocalDockerEndpoint, listEnvironmentNames, localDateTime, normalizeFixtureEmail, parseDevArgs, readEnvironment, validateEnvironment } from '../scripts/dev-environments.mjs';

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

interface DevEnvironmentTournament {
  key: string;
  startsAtLocalOffsetDays: number;
  [key: string]: unknown;
}

interface DevEnvironmentRoundEntry {
  kind: string;
  [key: string]: unknown;
}

interface DevEnvironmentLeague {
  id: string;
  name: string;
  status: string;
  tournaments: { id: string; leagueId: string; rounds: { entries: DevEnvironmentRoundEntry[] }[] }[];
}

interface DevEnvironment {
  name: string;
  description: string;
  resetDatabase: boolean;
  accounts: DevEnvironmentAccount[];
  tournaments: DevEnvironmentTournament[];
  leagues: DevEnvironmentLeague[];
  [key: string]: unknown;
}

const names = listEnvironmentNames() as string[];
const dataFiles = DATA_FILES as string[];
const read = (name: string): DevEnvironment => readEnvironment(name) as DevEnvironment;

function validEnvironment(): Record<string, unknown> {
  return {
    name: 'demo', directory: 'demo', description: 'valid fixture', resetDatabase: true,
    accounts: [{ email: 'user@gones.test', username: 'user', firstName: 'Demo', lastName: 'User', role: 'User', password: DEV_PASSWORD, emailConfirmed: true }],
    organizations: [], formats: [], tournaments: [], registrations: [], leagues: [], liveTournaments: []
  };
}

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

  it('the demo environment validates', () => {
    expect(validateEnvironment(read('demo'))).toEqual([]);
  });

  it('the demo environment covers every role and an unverified account', () => {
    const accounts = read('demo').accounts;

    expect(accounts).toHaveLength(7);
    expect(new Set(accounts.map((account) => account.role))).toEqual(new Set(['User', 'Organizer', 'Admin']));
    expect(accounts.filter((account) => account.emailConfirmed === false)).toHaveLength(1);
  });

  it('the demo environment still validates with leagues and running tournaments', () => {
    expect(validateEnvironment(read('demo'))).toEqual([]);
  });

  it('the demo archive carries two leagues, one completed and one active', () => {
    const leagues = read('demo').leagues;

    expect(leagues).toHaveLength(2);
    expect(new Set(leagues.map((league) => league.status))).toEqual(new Set(['completed', 'active']));
    expect(leagues.find((league) => league.status === 'completed')?.tournaments).toHaveLength(3);
  });

  it('every archive round entry is a match or a bye', () => {
    const entries = read('demo').leagues.flatMap((league) =>
      league.tournaments.flatMap((tournament) => tournament.rounds.flatMap((round) => round.entries))
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(['match', 'bye']).toContain(entry.kind);
  });

  it('the demo calendar spans past, today and future', () => {
    const offsets = read('demo').tournaments.map((tournament) => tournament.startsAtLocalOffsetDays);

    expect(offsets).toHaveLength(9);
    expect(offsets.filter((offset) => offset < 0).length).toBeGreaterThanOrEqual(1);
    expect(offsets.filter((offset) => offset === 0)).toHaveLength(1);
    expect(offsets.filter((offset) => offset > 0).length).toBeGreaterThanOrEqual(3);
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
  const invalidManifestCases: Array<[string, (fixture: Record<string, unknown>) => void, string]> = [
    ['missing name', (fixture) => { delete fixture['name']; }, 'name must be a non-empty string'],
    ['mismatched name', (fixture) => { fixture['name'] = 'other'; }, 'environment.json declares name "other" but lives in directory "demo"'],
    ['blank description', (fixture) => { fixture['description'] = '  '; }, 'description must be a non-empty string'],
    ['non-boolean reset', (fixture) => { fixture['resetDatabase'] = 'true'; }, 'resetDatabase must be a boolean']
  ];

  for (const [name, mutate, expected] of invalidManifestCases) {
    it(`rejects ${name}`, () => {
      const fixture = validEnvironment();
      mutate(fixture);
      expect(validateEnvironment(fixture)).toContain(`demo: ${expected}`);
    });
  }

  const invalidAccountCases: Array<[string, (account: Record<string, unknown>) => void, string]> = [
    ['malformed email', (account) => { account['email'] = 'invalid'; }, 'needs an email address'],
    ['blank username', (account) => { account['username'] = ' '; }, 'needs a non-empty username'],
    ['blank firstName', (account) => { account['firstName'] = ''; }, 'needs a non-empty firstName'],
    ['blank lastName', (account) => { account['lastName'] = ''; }, 'needs a non-empty lastName'],
    ['invalid role', (account) => { account['role'] = 'Owner'; }, 'has role "Owner"'],
    ['weak password', (account) => { account['password'] = 'weak'; }, 'has a password the server would refuse'],
    ['non-boolean emailConfirmed', (account) => { account['emailConfirmed'] = 'false'; }, 'has a non-boolean emailConfirmed']
  ];

  for (const [name, mutate, expected] of invalidAccountCases) {
    it(`rejects ${name}`, () => {
      const fixture = validEnvironment();
      const account = (fixture['accounts'] as Record<string, unknown>[])[0];
      mutate(account);
      expect((validateEnvironment(fixture) as string[]).some((problem) => problem.includes(expected))).toBe(true);
    });
  }

  it.each([
    ['email', { email: 'USER@gones.test', username: 'other' }, 'account email "USER@gones.test" is declared twice'],
    ['username', { email: 'other@gones.test', username: 'USER' }, 'account username "USER" is declared twice']
  ])('rejects duplicate %s case-insensitively', (_field, overrides, expected) => {
    const fixture = validEnvironment();
    const first = (fixture['accounts'] as Record<string, unknown>[])[0];
    (fixture['accounts'] as Record<string, unknown>[]).push({ ...first, ...overrides });
    expect(validateEnvironment(fixture)).toContain(`demo: ${expected}`);
  });

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

  it('a dangling cross-reference is reported', () => {
    const problems = validateEnvironment({
      name: 'demo-broken',
      description: 'one tournament pointing at no organization',
      resetDatabase: true,
      accounts: [{ email: 'o@gones.test', username: 'o', firstName: 'O', lastName: 'O', role: 'Organizer' }],
      organizations: [],
      formats: [{ key: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 10 }],
      tournaments: [{ key: 't1', organizationKey: 'nope', organizerEmail: 'o@gones.test', formatKeys: ['legacy'] }],
      registrations: [],
      leagues: [],
      liveTournaments: []
    }) as string[];

    expect(problems).toContain('demo-broken: tournament t1 references unknown organization nope');
  });

  it('a running tournament that claims an unknown league is reported', () => {
    const problems = validateEnvironment({
      name: 'demo-broken',
      description: 'a running tournament pointing at no league',
      resetDatabase: true,
      accounts: [{ email: 'organizer@gones.test', username: 'o', firstName: 'O', lastName: 'O', role: 'Organizer' }],
      organizations: [],
      formats: [],
      tournaments: [],
      registrations: [],
      leagues: [],
      liveTournaments: [{
        key: 'l1',
        organizerEmail: 'organizer@gones.test',
        leagueKey: 'nope',
        roundCount: 3,
        scoredRounds: 1,
        players: [{ name: 'A' }, { name: 'B' }]
      }]
    }) as string[];

    expect(problems).toContain('demo-broken: running tournament l1 references unknown league nope');
  });

  it('a running tournament cannot score more rounds than it has', () => {
    const problems = validateEnvironment({
      name: 'demo-broken',
      description: 'a running tournament scoring more rounds than it runs',
      resetDatabase: true,
      accounts: [{ email: 'organizer@gones.test', username: 'o', firstName: 'O', lastName: 'O', role: 'Organizer' }],
      organizations: [],
      formats: [],
      tournaments: [],
      registrations: [],
      leagues: [],
      liveTournaments: [{
        key: 'l1',
        organizerEmail: 'organizer@gones.test',
        leagueKey: null,
        roundCount: 2,
        scoredRounds: 3,
        players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]
      }]
    }) as string[];

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.includes('l1'))).toBe(true);
    expect(problems).toContain('demo-broken: running tournament l1 cannot score 3 of its 2 rounds');
  });
});

describe('seeder safety boundaries', () => {
  it.each(['tcp://127.0.0.1:2375', 'ssh://docker@example.test', 'npipe:////./pipe/docker_engine', 'http://example.test', 'unix://relative.sock', '', undefined])('refuses non-local Docker endpoint %s', (endpoint) => {
    expect(isLocalDockerEndpoint(endpoint)).toBe(false);
  });

  it.each(['unix:///var/run/docker.sock', 'unix:///run/user/1000/docker.sock'])('accepts local Unix Docker endpoint %s', (endpoint) => {
    expect(isLocalDockerEndpoint(endpoint)).toBe(true);
  });

  it('checks Docker endpoint before destructive compose reset', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/seed-dev-environment.mjs'), 'utf8');
    const reset = source.slice(source.indexOf('function resetDatabase()'), source.indexOf('function sqlLiteral'));
    expect(reset.indexOf('requireLocalDocker();')).toBeGreaterThan(-1);
    expect(reset.indexOf('requireLocalDocker();')).toBeLessThan(reset.indexOf("run('docker', ['compose'"));
  });

  it('resolves mixed-case fixture email references to the same token key', () => {
    const tokens = new Map([[normalizeFixtureEmail('Organizer@Gones.Test'), 'token']]);
    expect(tokens.get(normalizeFixtureEmail('organizer@gones.test'))).toBe('token');
  });
});

describe('relative fixture dates', () => {
  it('localDateTime builds a wire-shaped local timestamp', () => {
    expect(localDateTime(1, '09:00', new Date(2026, 0, 31))).toBe('2026-02-01T09:00');
  });
});
