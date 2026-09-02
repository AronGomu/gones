import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error - the dev account roster is a plain ESM module shared with the seeding script.
import { DEV_PASSWORD, meetsPasswordPolicy } from '../scripts/dev-accounts.mjs';
// @ts-expect-error - the environment loader is a plain ESM module shared with the seeding scripts.
import { ARCHIVE_DATA_FILES, ARCHIVE_DATA_VERSION, ARCHIVE_MAXIMUM_TOURNAMENT_BYTES, ARCHIVE_RESTORE_CAPS, ARCHIVE_RESTORE_KIND, buildArchiveBundle, countArchiveTournamentPlayers, DATA_FILES, DEV_ENVIRONMENTS_DIR, isArchiveTournamentLocked, isLocalDockerEndpoint, listEnvironmentNames, localDateTime, normalizeFixtureEmail, parseDevArgs, readEnvironment, validateEnvironment } from '../scripts/dev-environments.mjs';

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
  organizationKey: string;
  organizerEmail: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
  eventType: 'weekly' | 'monthly' | 'major';
  timeZoneId: string;
  startsAtLocalOffsetDays: number;
  startsAtLocalTime: string;
  endsAtLocalOffsetDays: number;
  endsAtLocalTime: string;
  capacity: number | null;
  formatKeys: string[];
  [key: string]: unknown;
}

interface DevEnvironmentFormat {
  key: string;
  name: string;
  slug: string;
  sortOrder: number;
}

interface DevEnvironmentRegistration {
  tournamentKey: string;
  userEmail: string;
}

interface DevEnvironmentOrganization {
  key: string;
  memberEmails: string[];
  [key: string]: unknown;
}

interface DevEnvironmentLiveTournament {
  organizerEmail: string;
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

interface DevArchiveLeague {
  id: string;
  name: string;
  createdAt: string;
  sourceSeriesId: null;
}

interface DevArchiveLeagueSeason {
  id: string;
  name: string;
  leagueId: string;
  status: string;
}

interface DevArchiveTournament {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;
  status: string;
  rounds: { id: string; entries: DevEnvironmentRoundEntry[] }[];
  playerArchetypes: { playerName: string; archetype: string }[];
}

interface DevEnvironment {
  name: string;
  description: string;
  resetDatabase: boolean;
  accounts: DevEnvironmentAccount[];
  organizations: DevEnvironmentOrganization[];
  formats: DevEnvironmentFormat[];
  tournaments: DevEnvironmentTournament[];
  registrations: DevEnvironmentRegistration[];
  liveTournaments: DevEnvironmentLiveTournament[];
  leagues: DevEnvironmentLeague[];
  archiveLeagues: DevArchiveLeague[];
  archiveLeagueSeasons: DevArchiveLeagueSeason[];
  archiveTournaments: DevArchiveTournament[];
  [key: string]: unknown;
}

const demoSplitSources: Record<string, string[]> = {
  'aura-winter-open': ['legacy', 'modern'],
  'pauper-night': ['legacy', 'pauper'],
  'aura-spring-classic': ['legacy', 'modern'],
  'commander-social': ['legacy', 'commander'],
  'aura-summer-open': ['legacy', 'modern', 'pauper', 'commander']
};

const slugify = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/**
 * The archive fixtures are absolute history (ADR 0030), so the lock window they straddle is measured
 * against a declared anchor rather than the clock — a clock-measured expectation would rot silently.
 */
const ANCHOR_ISO = '2026-08-22';
const ANCHOR = new Date(`${ANCHOR_ISO}T00:00:00Z`);

const names = listEnvironmentNames() as string[];
const dataFiles = DATA_FILES as string[];
/**
 * Environments whose data files are written on demand rather than committed (T29). `stress` ships only
 * its `environment.json`, so the cases below that walk every shipped dataset would otherwise be
 * asserting over seven empty arrays on one machine and a hundredfold dataset on the next.
 */
const generatedEnvironments = ['stress'];
const shippedNames = names.filter((name) => !generatedEnvironments.includes(name));
const read = (name: string): DevEnvironment => readEnvironment(name) as DevEnvironment;

function validEnvironment(): Record<string, unknown> {
  return {
    name: 'demo', directory: 'demo', description: 'valid fixture', resetDatabase: true,
    accounts: [{ email: 'user@gones.test', username: 'user', firstName: 'Demo', lastName: 'User', role: 'User', password: DEV_PASSWORD, emailConfirmed: true }],
    organizations: [], formats: [], tournaments: [], registrations: [], leagues: [], liveTournaments: [],
    archiveLeagues: [], archiveLeagueSeasons: [], archiveTournaments: []
  };
}

describe('shipped development environments', () => {
  it('every shipped environment validates', () => {
    expect(shippedNames.length).toBeGreaterThan(0);
    for (const name of shippedNames) expect(validateEnvironment(read(name)), name).toEqual([]);
  });

  it('skips the generated stress environment on purpose', () => {
    const stress = read('stress');

    // Deliberate, not an accident of a missing directory: the environment is declared, it is the only
    // name skipped, and everything but its manifest is gitignored because it is regenerated from a seed.
    expect(names).toContain('stress');
    expect(shippedNames).not.toContain('stress');
    expect(generatedEnvironments).toEqual(['stress']);
    expect(existsSync(join(process.cwd(), DEV_ENVIRONMENTS_DIR as string, 'stress', 'environment.json'))).toBe(true);
    expect(readFileSync(join(process.cwd(), '.gitignore'), 'utf8')).toContain('/fixtures/dev-environments/stress/*.json');
    expect(stress.resetDatabase).toBe(true);
    // Empty when the dataset has not been generated on this machine, the full hundredfold when it has;
    // either way it is the shape the seeder would accept.
    expect(validateEnvironment(stress)).toEqual([]);
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
    for (const name of shippedNames) {
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

  it('the demo archive carries Seasons in both statuses', () => {
    const seasons = read('demo').archiveLeagueSeasons;

    expect(seasons.length).toBeGreaterThan(1);
    expect(new Set(seasons.map((season) => season.status))).toEqual(new Set(['completed', 'active']));
  });

  it('every archive round entry is a match or a bye', () => {
    const entries = read('demo').archiveTournaments.flatMap((tournament) =>
      tournament.rounds.flatMap((round) => round.entries)
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(['match', 'bye']).toContain(entry.kind);
  });

  it('the demo calendar spans past, today and future', () => {
    const offsets = read('demo').tournaments.map((tournament) => tournament.startsAtLocalOffsetDays);

    expect(offsets).toHaveLength(16);
    expect(offsets.filter((offset) => offset < 0).length).toBeGreaterThanOrEqual(1);
    expect(offsets.filter((offset) => offset === 0)).toHaveLength(1);
    expect(offsets.filter((offset) => offset > 0).length).toBeGreaterThanOrEqual(3);
  });

  it('ships exact single-format split Events and server-derived slugs', () => {
    const demo = read('demo');
    const expectedSplitKeys = Object.entries(demoSplitSources).flatMap(([source, formats]) =>
      formats.map((format) => `${source}-${format}`)
    );
    const splitEvents = demo.tournaments.filter((event) =>
      Object.keys(demoSplitSources).some((source) => event.key.startsWith(`${source}-`))
    );
    const formatsByKey = new Map(demo.formats.map((format) => [format.key, format]));
    const derivedSlugs = demo.tournaments.map((event) => {
      const format = formatsByKey.get(event.formatKeys[0]);
      return `${slugify(event.title)}-${format?.slug}`;
    });
    const expectedSlugs = [
      'gones-league-7-day-1-legacy',
      'gones-league-7-day-2-legacy',
      'aura-winter-open-legacy',
      'aura-winter-open-modern',
      'gones-pauper-night-legacy',
      'gones-pauper-night-pauper',
      'gones-league-8-day-1-legacy',
      'aura-spring-classic-legacy',
      'aura-spring-classic-modern',
      'gones-commander-social-legacy',
      'gones-commander-social-commander',
      'ligue-aura-9-day-1-legacy',
      'aura-summer-open-legacy',
      'aura-summer-open-modern',
      'aura-summer-open-pauper',
      'aura-summer-open-commander'
    ];

    expect(demo.tournaments).toHaveLength(16);
    expect(demo.tournaments.every((event) => event.formatKeys.length === 1)).toBe(true);
    expect(splitEvents.map((event) => event.key).sort()).toEqual(expectedSplitKeys.sort());
    expect(derivedSlugs.sort()).toEqual(expectedSlugs.sort());
  });

  it('preserves split metadata and describes only each child format', () => {
    const demo = read('demo');
    const formatsByKey = new Map(demo.formats.map((format) => [format.key, format]));
    const metadata = (event: DevEnvironmentTournament) => ({
      organizationKey: event.organizationKey,
      organizerEmail: event.organizerEmail,
      streetAddress: event.streetAddress,
      postalCode: event.postalCode,
      city: event.city,
      country: event.country,
      timeZoneId: event.timeZoneId,
      startsAtLocalOffsetDays: event.startsAtLocalOffsetDays,
      startsAtLocalTime: event.startsAtLocalTime,
      endsAtLocalOffsetDays: event.endsAtLocalOffsetDays,
      endsAtLocalTime: event.endsAtLocalTime,
      capacity: event.capacity
    });

    for (const [source, formatKeys] of Object.entries(demoSplitSources)) {
      const children = formatKeys.map((format) => demo.tournaments.find((event) => event.key === `${source}-${format}`));
      expect(children.every(Boolean), source).toBe(true);
      expect(children.map((event) => metadata(event!))).toEqual(children.map(() => metadata(children[0]!)));

      for (const child of children) {
        const text = `${child!.summary} ${child!.bodyMarkdown}`.toLowerCase();
        const ownFormat = formatsByKey.get(child!.formatKeys[0])!.name.toLowerCase();
        expect(text, child!.key).toContain(ownFormat);
        for (const siblingKey of formatKeys.filter((key) => key !== child!.formatKeys[0])) {
          expect(text, child!.key).not.toContain(formatsByKey.get(siblingKey)!.name.toLowerCase());
        }
      }
    }
  });

  it('ships purpose accounts, ownership, Live organizers and registration counts', () => {
    const demo = read('demo');
    const expectedEmails = [
      'admin-empty@gones.test',
      'organizer-gones-one-registration@gones.test',
      'organizer-aura-live-standings@gones.test',
      'user-four-registrations@gones.test',
      'user-two-registrations@gones.test',
      'user-empty@gones.test',
      'user-unverified@gones.test'
    ];
    const counts = new Map(expectedEmails.map((email) => [email, demo.registrations.filter((registration) => registration.userEmail === email).length]));

    expect(demo.accounts.map((account) => account.email)).toEqual(expectedEmails);
    expect(demo.accounts.map((account) => account.username)).toEqual(expectedEmails.map((email) => email.split('@')[0]));
    expect(demo.accounts.map((account) => account.role)).toEqual(['Admin', 'Organizer', 'Organizer', 'User', 'User', 'User', 'User']);
    expect(demo.accounts.filter((account) => account.emailConfirmed === false).map((account) => account.email)).toEqual(['user-unverified@gones.test']);
    expect(demo.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'gones-lyon', memberEmails: ['organizer-gones-one-registration@gones.test'] }),
      expect.objectContaining({ key: 'aura-league', memberEmails: ['organizer-aura-live-standings@gones.test'] })
    ]));
    expect(demo.liveTournaments.map((live) => live.organizerEmail)).toEqual([
      'organizer-gones-one-registration@gones.test',
      'organizer-aura-live-standings@gones.test'
    ]);
    expect(Object.fromEntries(counts)).toEqual({
      'admin-empty@gones.test': 0,
      'organizer-gones-one-registration@gones.test': 1,
      'organizer-aura-live-standings@gones.test': 0,
      'user-four-registrations@gones.test': 4,
      'user-two-registrations@gones.test': 2,
      'user-empty@gones.test': 0,
      'user-unverified@gones.test': 0
    });
    expect(demo.registrations).toContainEqual({
      tournamentKey: 'aura-spring-classic-legacy',
      userEmail: 'organizer-gones-one-registration@gones.test'
    });
    expect(demo.registrations.every((registration) => !Object.keys(demoSplitSources).includes(registration.tournamentKey))).toBe(true);
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

  it.each([
    [{ region: '', eventType: 'weekly' }, 'needs a non-empty region'],
    [{ region: 'Auvergne-Rhône-Alpes', eventType: 'other' }, 'expected weekly, monthly, or major']
  ])('rejects invalid Event location/type metadata', (metadata, expected) => {
    const fixture = validEnvironment();
    fixture['accounts'] = [{ email: 'o@gones.test', username: 'o', firstName: 'O', lastName: 'O', role: 'Organizer' }];
    fixture['organizations'] = [{ key: 'org', memberEmails: ['o@gones.test'] }];
    fixture['formats'] = [{ key: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 10 }];
    fixture['tournaments'] = [{ key: 'open', organizationKey: 'org', organizerEmail: 'o@gones.test', title: 'Open', formatKeys: ['legacy'], ...metadata }];
    const problems = validateEnvironment(fixture) as string[];
    expect(problems.some((problem) => problem.includes(expected))).toBe(true);
  });

  it.each([{ formatKeys: [] }, { formatKeys: ['legacy', 'modern'] }])('rejects Events with $formatKeys formats', ({ formatKeys }) => {
    const fixture = validEnvironment();
    fixture['accounts'] = [{ email: 'o@gones.test', username: 'o', firstName: 'O', lastName: 'O', role: 'Organizer' }];
    fixture['organizations'] = [{ key: 'org', memberEmails: ['o@gones.test'] }];
    fixture['formats'] = [
      { key: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 10 },
      { key: 'modern', name: 'Modern', slug: 'modern', sortOrder: 20 }
    ];
    fixture['tournaments'] = [{ key: 'open', organizationKey: 'org', organizerEmail: 'o@gones.test', title: 'Open', formatKeys }];

    expect(validateEnvironment(fixture)).toContain(`demo: tournament open must reference exactly one format`);
  });

  it('rejects malformed or duplicate split keys', () => {
    const fixture = validEnvironment();
    fixture['accounts'] = [{ email: 'o@gones.test', username: 'o', firstName: 'O', lastName: 'O', role: 'Organizer' }];
    fixture['organizations'] = [{ key: 'org', memberEmails: ['o@gones.test'] }];
    fixture['formats'] = [
      { key: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 10 },
      { key: 'modern', name: 'Modern', slug: 'modern', sortOrder: 20 }
    ];
    fixture['tournaments'] = [
      { key: 'open-legacy', organizationKey: 'org', organizerEmail: 'o@gones.test', title: 'Open', formatKeys: ['legacy'] },
      { key: 'wrong-modern', organizationKey: 'org', organizerEmail: 'o@gones.test', title: 'Open', formatKeys: ['modern'] },
      { key: 'open-legacy', organizationKey: 'org', organizerEmail: 'o@gones.test', title: 'Open', formatKeys: ['legacy'] }
    ];

    const problems = validateEnvironment(fixture) as string[];
    expect(problems).toContain('demo: split tournament wrong-modern must use key "open-modern"');
    expect(problems).toContain('demo: tournament key "open-legacy" is declared twice');
  });

  it('reports renamed account references left dangling', () => {
    const fixture = validEnvironment();
    fixture['organizations'] = [{ key: 'org', memberEmails: ['old@gones.test'] }];
    fixture['liveTournaments'] = [{ key: 'live', organizerEmail: 'old@gones.test', leagueKey: null, roundCount: 1, scoredRounds: 0, players: [{ name: 'A' }, { name: 'B' }] }];
    fixture['registrations'] = [{ tournamentKey: 'missing', userEmail: 'old@gones.test' }];

    const problems = validateEnvironment(fixture) as string[];
    expect(problems).toContain('demo: organization org member old@gones.test is not a seeded account');
    expect(problems).toContain('demo: running tournament live organizer old@gones.test is not an Organizer');
    expect(problems).toContain('demo: registration missing/old@gones.test is not seedable');
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
      liveTournaments: [{
        key: 'l1',
        organizerEmail: 'organizer@gones.test',
        leagueKey: 'nope',
        roundCount: 3,
        scoredRounds: 1,
        players: [{ name: 'A' }, { name: 'B' }]
      }]
    }) as string[];

    expect(problems).toContain('demo-broken: running tournament l1 references unknown League Season nope');
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

  it('relaxes auth and write rate limits only for local environment seeding', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/seed-dev-environment.mjs'), 'utf8');
    const compose = readFileSync(join(process.cwd(), 'compose.yaml'), 'utf8');
    const seedEnvironment = source.slice(source.indexOf('function seedComposeEnv()'), source.indexOf('function run('));

    expect(seedEnvironment).toContain("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: process.env.GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT || '1000'");
    expect(seedEnvironment).toContain("GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT: process.env.GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT || '1000'");
    expect(compose).toContain('GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT: ${GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT:-}');
    // The stress environment raises all three buckets, including the admin one its 400-format catalog
    // would otherwise exhaust after sixty calls (T29). Compose still defaults every name to empty.
    expect(seedEnvironment).toContain("GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT: process.env.GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT || '100000'");
    expect(compose).toContain('GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT: ${GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT:-}');
  });

  it('resolves mixed-case fixture email references to the same token key', () => {
    const tokens = new Map([[normalizeFixtureEmail('Organizer@Gones.Test'), 'token']]);
    expect(tokens.get(normalizeFixtureEmail('organizer@gones.test'))).toBe('token');
  });

  it('keeps Event slug server-owned and validates the published slug', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/seed-dev-environment.mjs'), 'utf8');
    const seedEvents = source.slice(source.indexOf('async function seedEvents'), source.indexOf('async function seedRegistrations'));

    expect(seedEvents).not.toContain('slug:');
    expect(seedEvents).toContain('expectedEventSlug(entry.title, formatSlugs.get(entry.formatKeys[0]))');
    expect(seedEvents).toContain('published slug');
  });
});

describe('relative fixture dates', () => {
  it('localDateTime builds a wire-shaped local timestamp', () => {
    expect(localDateTime(1, '09:00', new Date(2026, 0, 31))).toBe('2026-02-01T09:00');
  });
});

/**
 * The three-tier archive fixtures (League -> League Season -> Tournament).
 *
 * These files are restored in one `POST /api/archive/restore-full` thirty seconds into a Docker
 * reset, so every shape the server would refuse has to be refused here first. The dates are absolute
 * history (ADR 0030), which is why the lock window is measured against the declared `ANCHOR` and
 * never against the clock: a clock-measured expectation would rot without anyone noticing.
 */
describe('three-tier archive fixtures', () => {
  const demo = (): DevEnvironment => read('demo');
  const nonAscii = (value: string): boolean => !/^[\x20-\x7e]*$/.test(value);
  const archiveFixture = (overrides: Record<string, unknown>): Record<string, unknown> => ({ ...validEnvironment(), ...overrides });
  const league = (id: string): DevArchiveLeague => ({ id, name: id, createdAt: '2024-01-08T09:00:00Z', sourceSeriesId: null });
  const season = (id: string, leagueId: string, status = 'completed'): DevArchiveLeagueSeason => ({ id, name: id, leagueId, status });
  const tournament = (id: string, seasonId: string | null, overrides: Record<string, unknown> = {}): DevArchiveTournament => ({
    id, name: id, seasonId, tournamentDate: '2024-09-05', status: 'completed', rounds: [], playerArchetypes: [], ...overrides
  } as DevArchiveTournament);
  const problemsFor = (fixture: Record<string, unknown>): string[] => validateEnvironment(fixture, { today: ANCHOR }) as string[];

  it('names the three archive files as ordinary data files', () => {
    expect(ARCHIVE_DATA_FILES).toEqual(['archiveLeagues', 'archiveLeagueSeasons', 'archiveTournaments']);
    for (const key of ARCHIVE_DATA_FILES as string[]) expect(dataFiles, key).toContain(key);
  });

  it('every shipped environment still validates with an archive', () => {
    expect(shippedNames.length).toBeGreaterThan(0);
    for (const name of shippedNames) expect(validateEnvironment(read(name), { today: ANCHOR }), name).toEqual([]);
  });

  it('the demo archive carries eight Leagues, twelve Seasons and forty-eight Tournaments', () => {
    const fixtures = demo();

    expect(fixtures.archiveLeagues).toHaveLength(8);
    expect(fixtures.archiveLeagueSeasons).toHaveLength(12);
    expect(fixtures.archiveTournaments).toHaveLength(48);
  });

  it('every demo archive League declares a null sourceSeriesId', () => {
    // Public archives expose no series and no season field at all; the League tier is this project's
    // own construct, and the fixture says so in a machine-checkable way rather than in a comment.
    for (const entry of demo().archiveLeagues) {
      expect(Object.hasOwn(entry, 'sourceSeriesId'), entry.id).toBe(true);
      expect(entry.sourceSeriesId, entry.id).toBeNull();
    }
  });

  it('every demo archive Season names a League that exists', () => {
    const fixtures = demo();
    const leagueIds = new Set(fixtures.archiveLeagues.map(({ id }) => id));
    const named = new Set(fixtures.archiveLeagueSeasons.map(({ leagueId }) => leagueId));

    for (const entry of fixtures.archiveLeagueSeasons) expect(leagueIds, entry.id).toContain(entry.leagueId);
    for (const entry of fixtures.archiveLeagues) expect(named, entry.id).toContain(entry.id);
  });

  it('every demo archive Tournament is standalone or names a Season that exists', () => {
    const fixtures = demo();
    const seasonIds = new Set(fixtures.archiveLeagueSeasons.map(({ id }) => id));

    for (const entry of fixtures.archiveTournaments) {
      if (entry.seasonId !== null) expect(seasonIds, entry.id).toContain(entry.seasonId);
    }
    expect(fixtures.archiveTournaments.filter((entry) => entry.seasonId === null)).toHaveLength(5);
  });

  it('the demo archive keeps Season names as free strings', () => {
    const labels = demo().archiveLeagueSeasons.map(({ name }) => name);

    // The label styles real public archives use. None of them is a year column, and a fixture that
    // only carried `2026` would let a year-parsing regression pass unnoticed.
    for (const label of ['Season 3', '2026', '2025-26', '1996-97', 'Season 5 - Round 2', '3ª Etapa Regular - 2026/2', 'Liga Sword - Primeira Etapa']) {
      expect(labels, label).toContain(label);
    }
    expect(labels.filter((label) => Number.isNaN(Number(label))).length).toBeGreaterThanOrEqual(4);
  });

  it('the demo archive runs one Season across a calendar year boundary', () => {
    const fixtures = demo();
    const crossYear = fixtures.archiveLeagueSeasons.find(({ name }) => name === '2025-26');
    const played = fixtures.archiveTournaments.filter((entry) => entry.seasonId === crossYear?.id);

    expect(crossYear).toBeDefined();
    expect(new Set(played.map((entry) => entry.tournamentDate.slice(0, 4)))).toEqual(new Set(['2025', '2026']));
    expect(played.some((entry) => isArchiveTournamentLocked(entry.tournamentDate, ANCHOR))).toBe(true);
    expect(played.some((entry) => !isArchiveTournamentLocked(entry.tournamentDate, ANCHOR))).toBe(true);
  });

  it('the demo archive spreads Tournaments per Season wildly', () => {
    const fixtures = demo();
    const counts = fixtures.archiveLeagueSeasons
      .map((entry) => fixtures.archiveTournaments.filter((played) => played.seasonId === entry.id).length)
      .sort((left, right) => left - right);

    expect(counts).toEqual([0, 1, 1, 1, 2, 2, 3, 3, 4, 7, 8, 11]);
    expect(new Set(counts).size).toBe(8);
    expect(Math.max(...counts)).toBe(11);
  });

  it('the demo archive ships an empty Season', () => {
    const fixtures = demo();
    const empty = fixtures.archiveLeagueSeasons.filter((entry) =>
      fixtures.archiveTournaments.every((played) => played.seasonId !== entry.id));

    expect(empty).toHaveLength(1);
  });

  it('the demo archive ships a child series whose name embeds its parent\'s', () => {
    const labels = demo().archiveLeagues.map(({ name }) => name);
    const embedded = labels.flatMap((parent) => labels
      .filter((child) => child !== parent && child.startsWith(parent))
      .map((child) => [parent, child]));

    expect(embedded).toEqual([['Pro Tour Aetherdrift', 'Pro Tour Aetherdrift - 2nd Chance PTQ']]);
  });

  it('the demo archive keeps degenerate names as standalone Tournaments', () => {
    const fixtures = demo();
    const degenerate = ['Series', '1K', 'FNM', 'Weekly'];
    const standalone = fixtures.archiveTournaments.filter((entry) => entry.seasonId === null).map(({ name }) => name);

    for (const name of degenerate) expect(standalone, name).toContain(name);
    for (const name of degenerate) {
      expect(fixtures.archiveLeagues.map((entry) => entry.name), name).not.toContain(name);
      expect(fixtures.archiveLeagueSeasons.map((entry) => entry.name), name).not.toContain(name);
    }
  });

  it('the demo archive carries non-ASCII names', () => {
    const fixtures = demo();
    const strings = [
      ...fixtures.archiveLeagues.map(({ name }) => name),
      ...fixtures.archiveLeagueSeasons.map(({ name }) => name),
      ...fixtures.archiveTournaments.map(({ name }) => name),
      ...fixtures.archiveTournaments.flatMap((entry) => entry.playerArchetypes.map(({ playerName }) => playerName))
    ];

    expect([...new Set(strings.filter(nonAscii))].sort()).toEqual(
      ['3ª Etapa Regular - 2026/2', 'Gdańsk', 'Montréal', 'Zoé Rambaud', 'Łukasz Wiśniewski'].sort()
    );
  });

  it('the demo archive reaches both sides of the lock window', () => {
    const dates = demo().archiveTournaments.map(({ tournamentDate }) => tournamentDate);

    expect(dates.filter((date) => isArchiveTournamentLocked(date, ANCHOR))).toHaveLength(24);
    expect(dates.filter((date) => !isArchiveTournamentLocked(date, ANCHOR))).toHaveLength(24);
  });

  it('the demo archive keeps every Tournament in the past', () => {
    for (const entry of demo().archiveTournaments) {
      expect(Date.parse(entry.tournamentDate), entry.id).toBeLessThanOrEqual(Date.parse(ANCHOR_ISO));
    }
  });

  it('every demo archive round entry is a match or a bye', () => {
    const entries = demo().archiveTournaments.flatMap((entry) => entry.rounds.flatMap((round) => round.entries));

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(['match', 'bye']).toContain(entry.kind);
  });

  it('every demo archive Season keeps a completed Tournament', () => {
    const fixtures = demo();

    for (const entry of fixtures.archiveLeagueSeasons) {
      const played = fixtures.archiveTournaments.filter((candidate) => candidate.seasonId === entry.id);
      if (played.length === 0) continue;
      // An `active` Tournament contributes to no player-statistics scope, so a Season made only of
      // them would be statistically empty and its rankings would render nothing.
      expect(played.filter((candidate) => candidate.status === 'completed').length, entry.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('a dangling archive Season league reference is reported', () => {
    const problems = problemsFor(archiveFixture({
      archiveLeagues: [league('l1')],
      archiveLeagueSeasons: [season('s1', 'nope')]
    }));

    expect(problems).toContain('demo: archive League Season s1 references unknown archive League nope');
  });

  it('a dangling archive Tournament season reference is reported', () => {
    const problems = problemsFor(archiveFixture({
      archiveLeagues: [league('l1')],
      archiveLeagueSeasons: [season('s1', 'l1')],
      archiveTournaments: [tournament('t1', 'nope')]
    }));

    expect(problems).toContain('demo: archive Tournament t1 references unknown archive League Season nope');
  });

  it('a standalone archive Tournament is accepted', () => {
    expect(problemsFor(archiveFixture({ archiveTournaments: [tournament('t1', null)] }))).toEqual([]);
  });

  it('an archive League without the sourceSeriesId marker is reported', () => {
    const expected = 'demo: archive League l1 must declare "sourceSeriesId": null — public archives expose no series field';
    const { sourceSeriesId: _absent, ...missing } = league('l1');

    expect(problemsFor(archiveFixture({ archiveLeagues: [missing] }))).toContain(expected);
    expect(problemsFor(archiveFixture({ archiveLeagues: [{ ...league('l1'), sourceSeriesId: 'series-9' }] }))).toContain(expected);
  });

  it('a future archive Tournament date is reported', () => {
    const problems = problemsFor(archiveFixture({ archiveTournaments: [tournament('t1', null, { tournamentDate: '2999-01-01' })] }));

    expect(problems).toContain('demo: archive Tournament t1 is dated in the future (2999-01-01) — an archive is history (ADR 0030)');
  });

  it('a non-ISO archive Tournament date is reported', () => {
    const problems = problemsFor(archiveFixture({ archiveTournaments: [tournament('t1', null, { tournamentDate: '05/09/2024' })] }));

    expect(problems).toContain('demo: archive Tournament t1 has tournamentDate "05/09/2024", expected an ISO YYYY-MM-DD date');
  });

  it('a bad archive status is reported', () => {
    const problems = problemsFor(archiveFixture({
      archiveLeagues: [league('l1')],
      archiveLeagueSeasons: [season('s1', 'l1', 'finished')],
      archiveTournaments: [tournament('t1', 's1', { status: 'draft' })]
    }));

    expect(problems).toContain('demo: archive League Season s1 has status "finished", expected one of active, completed');
    expect(problems).toContain('demo: archive Tournament t1 has status "draft", expected one of active, completed');
  });

  it('a duplicate archive id is reported at every tier', () => {
    const problems = problemsFor(archiveFixture({
      archiveLeagues: [league('l1'), league('l1')],
      archiveLeagueSeasons: [season('s1', 'l1'), season('s1', 'l1')],
      archiveTournaments: [tournament('t1', 's1'), tournament('t1', 's1')]
    }));

    expect(problems).toContain('demo: duplicate archive League id l1');
    expect(problems).toContain('demo: duplicate archive League Season id s1');
    expect(problems).toContain('demo: duplicate archive Tournament id t1');
  });

  it('an oversized archive Tournament document is reported', () => {
    const padded = tournament('t1', null, {
      playerArchetypes: [{ playerName: 'A'.repeat(ARCHIVE_MAXIMUM_TOURNAMENT_BYTES as number), archetype: '' }]
    });

    expect(problemsFor(archiveFixture({ archiveTournaments: [padded] })).join('\n'))
      .toContain(`over the ${ARCHIVE_MAXIMUM_TOURNAMENT_BYTES} byte document limit the server refuses`);
  });

  it('an archive over the restore cap is reported', () => {
    const cap = (ARCHIVE_RESTORE_CAPS as { leagues: number }).leagues;
    const overflowing = Array.from({ length: cap + 1 }, (_, index) => league(`l${index}`));

    expect(problemsFor(archiveFixture({ archiveLeagues: overflowing })))
      .toContain(`demo: the archive carries ${cap + 1} Leagues, over the ${cap} the restore endpoint accepts`);
  });

  it('the lock rule matches the domain at both boundaries', () => {
    const played = Date.parse('2025-01-01T00:00:00Z');
    const dayAfter = (days: number): Date => new Date(played + days * 86_400_000);

    // 365 whole UTC days is still writable; 366 is not. The domain draws the line in the same place.
    expect(isArchiveTournamentLocked('2025-01-01', dayAfter(365))).toBe(false);
    expect(isArchiveTournamentLocked('2025-01-01', dayAfter(366))).toBe(true);
  });

  it('the seeder restores the archive through restore-full as an Admin', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/seed-dev-environment.mjs'), 'utf8');
    const start = source.indexOf('async function seedArchive');
    const seedArchive = source.slice(start, source.indexOf('async function', start + 1));

    expect(start).toBeGreaterThan(-1);
    expect(seedArchive).toContain('ARCHIVE_RESTORE_PATH');
    expect(seedArchive).toContain("tokenForRole(environment, tokens, 'Admin', 'archive')");
    expect(seedArchive).toContain('buildArchiveBundle(environment)');
    expect(seedArchive).toContain('-archive-restore-full');
    // A fixture archive is history, and the interactive create route refuses a non-Admin a Tournament
    // older than the lock window; restore is the only path it can take.
    expect(seedArchive).not.toContain("/api/archive/tournaments'");
  });

  it('the seeder resolves a running tournament League against the three-tier Seasons', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/seed-dev-environment.mjs'), 'utf8');

    // `POST /api/live-tournaments` resolves its leagueId against `archive_league_seasons` now (T19),
    // so the retired legacy restore must not come back as a second seeding path.
    expect(source).not.toContain('leagues-archive');
    expect(source).toContain('seedLiveTournaments(environment, tokens, archiveIds.leagueSeasons)');
  });

  it('buildArchiveBundle strips the fixture-only provenance marker', () => {
    const bundle = buildArchiveBundle(demo()) as { kind: string; version: number; leagues: Record<string, unknown>[] };

    expect(bundle.kind).toBe(ARCHIVE_RESTORE_KIND);
    expect(bundle.kind).toBe('fullArchive');
    expect(bundle.version).toBe(ARCHIVE_DATA_VERSION);
    expect(bundle.version).toBe(5);
    for (const entry of bundle.leagues) expect(Object.hasOwn(entry, 'sourceSeriesId'), String(entry['id'])).toBe(false);
  });

  it('countArchiveTournamentPlayers counts the standings rows', () => {
    const match = (id: string, player1Name: string, player2Name: string, player1Score: number, player2Score: number) =>
      ({ kind: 'match', id, table: '1', player1Name, player2Name, player1Score, player2Score, player1DeckArchetype: '', player2DeckArchetype: '' });
    const counted = countArchiveTournamentPlayers({
      rounds: [{
        id: 'r1',
        entries: [
          match('m1', 'Alix Aubert', 'Bastien Bonnet', 2, 0),
          { kind: 'bye', id: 'b1', table: '2', playerName: 'Camille Chartier', deckArchetype: '' },
          match('m2', 'Damien Delaunay', 'Damien Delaunay', 2, 0),
          { kind: 'bye', id: 'b2', table: '3', playerName: 'BYE', deckArchetype: '' },
          match('m3', 'Elodie Estivals', 'Fabien Fournier', 3, 0)
        ]
      }]
    });

    expect(counted).toBe(3);
  });
});
