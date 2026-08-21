#!/usr/bin/env node
/**
 * Writes the `stress` development environment: a hundredfold of `demo`, generated from a seeded PRNG
 * (T29, ADR 0030).
 *
 * The dataset is too large to commit — `fixtures/dev-environments/stress/` ships only its
 * `environment.json` and every other file there is gitignored — so it is rebuilt on demand instead:
 * `npm run dev:stress:generate -- --seed=1` writes the fixtures, `npm run dev -- --env=stress` loads
 * them. The same seed has to produce byte-identical files on any machine, which is why every draw goes
 * through `mulberry32` and nothing in here reads the clock: the Calendar dates are relative day offsets
 * rendered at seeding time, exactly as the committed environments write them, and the archive dates are
 * absolute literals counted off a fixed epoch.
 *
 * `audit-records.json` is the one file `DATA_FILES` does not name: audit rows have no fixture format
 * and no HTTP endpoint, so they are generated here — where the seed lives — and read straight from this
 * directory by `scripts/bulk-load-stress.mjs`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STRESS_ENVIRONMENT = 'stress';
export const STRESS_DIRECTORY = join('fixtures', 'dev-environments', STRESS_ENVIRONMENT);
export const AUDIT_FILE = 'audit-records.json';
export const DEFAULT_SEED = 1;

/**
 * 100× the `demo` environment, which carries 7 accounts (1 Admin, 2 Organizers, 4 Users, one of them
 * unverified), 2 organizations, 4 formats, 16 Events, 7 registrations, 2 League Archives with 4 Archive
 * Tournaments between them, and 2 running tournaments. Running tournaments are the deliberate exception
 * (round 2 Q6): they are replayed through the real Live commands one command at a time, so they are
 * capped at ten however far the rest scales.
 */
export const STRESS_VOLUMES = {
  admins: 100,
  organizers: 200,
  users: 400,
  unverifiedUsers: 100,
  organizations: 200,
  formats: 400,
  events: 1600,
  registrations: 700,
  leagues: 200,
  tournamentsPerLeague: 2,
  roundsPerTournament: 3,
  playersPerTournament: 8,
  liveTournaments: 10,
  auditRecords: 10000,
  playerPool: 2000
};

/** Events land between two years back and two years out, with the middle one exactly today. */
const PAST_DAYS = 420;
const FUTURE_DAYS = 420;
/** Archive Tournaments are history, so their dates are absolute and counted off this fixed Monday. */
const ARCHIVE_EPOCH = Date.UTC(2023, 0, 2);
const ARCHIVE_WEEKS = 170;

const FIRST_NAMES = [
  'Alix', 'Bastien', 'Camille', 'Damien', 'Elodie', 'Fabien', 'Gaelle', 'Hugo', 'Ines', 'Julien',
  'Karim', 'Louise', 'Maxime', 'Nadia', 'Olivier', 'Perrine', 'Quentin', 'Romain', 'Sabine', 'Thibault',
  'Ulysse', 'Valentine', 'Wassim', 'Xavier', 'Yasmine', 'Zoe', 'Amaury', 'Benoit', 'Clarisse', 'Dorian',
  'Emeric', 'Flavie', 'Gaspard', 'Helene', 'Ismael', 'Joachim', 'Klara', 'Lucien', 'Margaux', 'Noe',
  'Ombeline', 'Pacome', 'Quitterie', 'Raphael', 'Solene', 'Tristan', 'Ursule', 'Victor', 'Wilfried', 'Yann'
];

const LAST_NAMES = [
  'Aubert', 'Bonnet', 'Chartier', 'Delaunay', 'Estivals', 'Fournier', 'Guerin', 'Hamon', 'Imbert', 'Jourdan',
  'Kessler', 'Lacombe', 'Marchand', 'Noiret', 'Ollivier', 'Peyron', 'Quesnel', 'Rambaud', 'Sabatier', 'Tessier',
  'Urbain', 'Vasseur', 'Weber', 'Ybert', 'Zamora', 'Andrieu', 'Bosc', 'Cadiou', 'Dubreuil', 'Escoffier',
  'Fayolle', 'Gontier', 'Huguet', 'Isnard', 'Jaillet', 'Larcher', 'Mounier', 'Nivelle', 'Odin', 'Pruvost'
];

const CITIES = [
  ['Lyon', '69002', 'France'], ['Villeurbanne', '69100', 'France'], ['Saint-Etienne', '42000', 'France'],
  ['Grenoble', '38000', 'France'], ['Clermont-Ferrand', '63000', 'France'], ['Annecy', '74000', 'France'],
  ['Chambery', '73000', 'France'], ['Valence', '26000', 'France'], ['Bourg-en-Bresse', '01000', 'France'],
  ['Roanne', '42300', 'France'], ['Vienne', '38200', 'France'], ['Aix-les-Bains', '73100', 'France']
];

const CLUB_WORDS = ['Club', 'Ligue', 'Guilde', 'Cercle', 'Association', 'Collectif', 'Atelier', 'Taverne'];
const EVENT_WORDS = ['Open', 'Showdown', 'Night', 'Classic', 'Trial', 'Masters', 'Cup', 'Challenge', 'Social', 'Grinder'];
const FORMAT_BASES = ['Legacy', 'Modern', 'Pauper', 'Commander', 'Vintage', 'Pioneer', 'Standard', 'Duel Commander'];
const STREETS = ['rue de la Republique', 'avenue Jean Jaures', 'cours Lafayette', 'quai Saint-Antoine', 'rue Victor Hugo', 'place Bellecour'];

/**
 * Every audit row lands under an action the API really writes, so `/admin/audit` filters and groups the
 * generated volume the same way it groups a real one.
 */
const AUDIT_ACTIONS = [
  ['auth.login.succeeded', 'user'],
  ['auth.login.failed', 'user'],
  ['auth.register.succeeded', 'user'],
  ['auth.session.created', 'refresh_session'],
  ['auth.sessions.revoked_all', 'user'],
  ['auth.email.verification_resent', 'user'],
  ['tournament.published', 'scheduled_tournament'],
  ['tournament.registration.confirmed', 'tournament_registration'],
  ['organization.member.removed', 'organization_member'],
  ['admin.format.created', 'tournament_format'],
  ['live.created', 'live-tournament'],
  ['live.player.added', 'live-tournament'],
  ['live.round.started', 'live-tournament'],
  ['live.round.validated', 'live-tournament']
];

/** `[0, 1)` from a 32-bit seed, the standard mulberry32. No global state, so two runs cannot interfere. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (value, width) => String(value).padStart(width, '0');
const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, minimum, maximum) => minimum + Math.floor(random() * (maximum - minimum + 1));

const slugify = (value) => value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/** The 40 archetypes the ticket asks for, taken from the JSON twin of `legacy-archetype-presets.ts`. */
function readArchetypes(root = process.cwd()) {
  const presets = JSON.parse(readFileSync(join(root, 'src/assets/config/legacy-archetype-presets.json'), 'utf8'));
  return presets.archetypes.slice(0, 40);
}

/**
 * A fixed pool of synthetic player names, first names crossed with surnames in a stable order. The pool
 * is fixed rather than drawn so the seed only decides who plays where: rankings and player pages need a
 * bounded cast that recurs across Leagues, not a fresh name per Match.
 */
export function playerNamePool(size) {
  const names = [];
  for (let index = 0; index < size; index += 1) {
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
    names.push(`${first} ${last}`);
  }
  return names;
}

/**
 * Cubed draw, so the front of the pool plays far more than the back. A uniform draw over two thousand
 * names would give every player the same five Matches and no page worth stress testing; this leaves a
 * few dozen regulars with hundreds of Matches, which is what a heavy player page has to survive.
 */
const weightedPlayer = (random, pool) => pool[Math.min(pool.length - 1, Math.floor(pool.length * random() ** 3))];

function distinctPlayers(random, pool, count) {
  const roster = [];
  const seen = new Set();
  // Bounded: after enough weighted misses the scan falls back to the next unused name in the pool.
  for (let attempt = 0; roster.length < count && attempt < count * 40; attempt += 1) {
    const name = weightedPlayer(random, pool);
    if (seen.has(name)) continue;
    seen.add(name);
    roster.push(name);
  }
  for (let index = 0; roster.length < count; index += 1) {
    const name = pool[index % pool.length];
    if (seen.has(name)) continue;
    seen.add(name);
    roster.push(name);
  }
  return roster;
}

/** `YYYY-MM-DD`, `days` after the fixed archive epoch. Absolute on purpose: an archive is history. */
function archiveDate(days) {
  const date = new Date(ARCHIVE_EPOCH + days * 86400000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** A ramp from `-PAST_DAYS` to `+FUTURE_DAYS`, with the middle Event pinned to today. */
function eventOffset(index, count) {
  if (index === Math.floor(count / 2)) return 0;
  const span = PAST_DAYS + FUTURE_DAYS;
  return Math.round((index * span) / Math.max(1, count - 1)) - PAST_DAYS;
}

function scaledVolumes(scale) {
  const scaled = (value) => Math.max(1, Math.round(value * scale));
  return {
    ...STRESS_VOLUMES,
    admins: scaled(STRESS_VOLUMES.admins),
    organizers: scaled(STRESS_VOLUMES.organizers),
    users: scaled(STRESS_VOLUMES.users),
    unverifiedUsers: Math.min(scaled(STRESS_VOLUMES.unverifiedUsers), scaled(STRESS_VOLUMES.users) - 1),
    organizations: scaled(STRESS_VOLUMES.organizations),
    formats: scaled(STRESS_VOLUMES.formats),
    events: scaled(STRESS_VOLUMES.events),
    registrations: scaled(STRESS_VOLUMES.registrations),
    leagues: scaled(STRESS_VOLUMES.leagues),
    auditRecords: scaled(STRESS_VOLUMES.auditRecords),
    playerPool: scaled(STRESS_VOLUMES.playerPool),
    // Ten Live command replays is already the slowest part of a seed; scaling down is allowed, up is not.
    liveTournaments: Math.min(STRESS_VOLUMES.liveTournaments, scaled(STRESS_VOLUMES.liveTournaments))
  };
}

function generateAccounts(random, volumes) {
  const accounts = [];
  const person = () => ({ firstName: pick(random, FIRST_NAMES), lastName: pick(random, LAST_NAMES) });

  for (let index = 0; index < volumes.admins; index += 1) {
    accounts.push({ email: `stress-admin-${pad(index, 3)}@gones.test`, username: `stress-admin-${pad(index, 3)}`, ...person(), role: 'Admin' });
  }
  for (let index = 0; index < volumes.organizers; index += 1) {
    accounts.push({ email: `stress-organizer-${pad(index, 3)}@gones.test`, username: `stress-organizer-${pad(index, 3)}`, ...person(), role: 'Organizer' });
  }
  for (let index = 0; index < volumes.users; index += 1) {
    const account = { email: `stress-user-${pad(index, 3)}@gones.test`, username: `stress-user-${pad(index, 3)}`, ...person(), role: 'User' };
    // The unverified block sits at the end so every earlier index stays registerable for content.
    if (index >= volumes.users - volumes.unverifiedUsers) account.emailConfirmed = false;
    accounts.push(account);
  }
  return accounts;
}

function generateOrganizations(random, volumes, organizers) {
  const organizations = [];
  for (let index = 0; index < volumes.organizations; index += 1) {
    const [city] = CITIES[index % CITIES.length];
    const name = `${pick(random, CLUB_WORDS)} ${city} ${pad(index, 3)}`;
    organizations.push({
      key: `stress-org-${pad(index, 3)}`,
      name,
      description: `Stress fixture organization ${pad(index, 3)} running events in ${city}.`,
      website: `https://${slugify(name)}.test`,
      contactEmail: `contact@${slugify(name)}.test`,
      memberEmails: [organizers[index % organizers.length].email]
    });
  }
  return organizations;
}

function generateFormats(volumes) {
  const formats = [];
  for (let index = 0; index < volumes.formats; index += 1) {
    const base = FORMAT_BASES[index % FORMAT_BASES.length];
    const season = Math.floor(index / FORMAT_BASES.length) + 1;
    const name = `${base} Season ${season}`;
    formats.push({ key: `stress-format-${pad(index, 3)}`, name, slug: slugify(name), sortOrder: (index + 1) * 10 });
  }
  return formats;
}

function generateEvents(random, volumes, organizations, formats) {
  const events = [];
  for (let index = 0; index < volumes.events; index += 1) {
    const organization = organizations[index % organizations.length];
    const format = formats[index % formats.length];
    const [city, postalCode, country] = CITIES[index % CITIES.length];
    const offset = eventOffset(index, volumes.events);
    const startHour = 9 + (index % 4) * 2;
    const title = `${organization.name} ${pick(random, EVENT_WORDS)} ${pad(index, 4)}`;
    events.push({
      key: `stress-event-${pad(index, 4)}`,
      organizationKey: organization.key,
      organizerEmail: organization.memberEmails[0],
      title,
      summary: `Stress fixture event ${pad(index, 4)} in ${city}.`.slice(0, 50),
      bodyHtml: `<p>${format.name} event ${pad(index, 4)} hosted by ${organization.name}.</p><ul><li>Doors at ${pad(startHour - 1, 2)}:30</li><li>Decklists required</li></ul>`,
      streetAddress: `${between(random, 1, 180)} ${pick(random, STREETS)}`,
      postalCode,
      city,
      country,
      timeZoneId: 'Europe/Paris',
      startsAtLocalOffsetDays: offset,
      startsAtLocalTime: `${pad(startHour, 2)}:00`,
      endsAtLocalOffsetDays: offset,
      endsAtLocalTime: `${pad(startHour + 8, 2)}:00`,
      capacity: index % 5 === 0 ? null : between(random, 32, 256),
      formatKeys: [format.key]
    });
  }
  return events;
}

/**
 * Registrations sit on Events that have not started yet — the API closes registration at start time, so
 * a fixture that put them in the past would describe a state the app cannot produce — and they are
 * concentrated on the first slice of those, so the participants screen has Events with a real roster
 * rather than seven hundred Events with one registrant each.
 */
function generateRegistrations(random, volumes, events, registrableAccounts) {
  const upcoming = events.filter((event) => event.startsAtLocalOffsetDays >= 7);
  const hosts = upcoming.slice(0, Math.max(1, Math.ceil(upcoming.length / 6)));
  const registrations = [];
  const seen = new Set();

  for (let attempt = 0; registrations.length < volumes.registrations && attempt < volumes.registrations * 50; attempt += 1) {
    const event = hosts[Math.floor(random() * hosts.length)];
    const account = registrableAccounts[Math.floor(random() * registrableAccounts.length)];
    const key = `${event.key}/${account.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    registrations.push({ tournamentKey: event.key, userEmail: account.email });
  }
  return registrations;
}

/**
 * One League Archive document per League, the same shape a League Export carries. Every Archive
 * Tournament claims its own parent — a Tournament that names another League is refused on read by
 * `LeagueArchiveAggregate.ValidateDocument`, and a bulk-inserted document is only ever read.
 */
function generateLeagues(random, volumes, pool, archetypes) {
  const leagues = [];
  for (let index = 0; index < volumes.leagues; index += 1) {
    const leagueId = `stress-league-${pad(index, 3)}`;
    const tournaments = [];

    for (let day = 0; day < volumes.tournamentsPerLeague; day += 1) {
      const tournamentId = `${leagueId}-day-${day + 1}`;
      // Every League keeps at least one completed Archive Tournament: statistics only count those, and
      // a League with none would be a League no ranking, player page or result screen can see.
      const status = day > 0 && index % 8 === 0 ? 'active' : 'completed';
      // Seven players once in a while, so a Bye entry exists in the archive too.
      const rosterSize = index % 9 === 0 ? volumes.playersPerTournament - 1 : volumes.playersPerTournament;
      const roster = distinctPlayers(random, pool, rosterSize);
      const rounds = [];

      for (let round = 0; round < volumes.roundsPerTournament; round += 1) {
        const shuffled = [...roster];
        for (let position = shuffled.length - 1; position > 0; position -= 1) {
          const swap = Math.floor(random() * (position + 1));
          [shuffled[position], shuffled[swap]] = [shuffled[swap], shuffled[position]];
        }

        const entries = [];
        let table = 1;
        while (shuffled.length - (table - 1) * 2 >= 2) {
          const player1 = shuffled[(table - 1) * 2];
          const player2 = shuffled[(table - 1) * 2 + 1];
          const [player1Score, player2Score] = pick(random, [[2, 0], [2, 1], [1, 1], [0, 2], [1, 2]]);
          entries.push({
            kind: 'match',
            id: `${tournamentId}-r${round + 1}-m${table}`,
            table: String(table),
            player1Name: player1,
            player2Name: player2,
            player1Score,
            player2Score,
            // Half the Matches record their own archetypes and half fall back to the roster, exactly as
            // a hand-kept archive does.
            player1DeckArchetype: random() < 0.5 ? pick(random, archetypes) : '',
            player2DeckArchetype: random() < 0.5 ? pick(random, archetypes) : ''
          });
          table += 1;
        }
        if (shuffled.length % 2 === 1) {
          entries.push({
            kind: 'bye',
            id: `${tournamentId}-r${round + 1}-b${table}`,
            table: String(table),
            playerName: shuffled[shuffled.length - 1],
            deckArchetype: ''
          });
        }
        rounds.push({ id: `${tournamentId}-r${round + 1}`, entries });
      }

      tournaments.push({
        id: tournamentId,
        leagueId,
        name: `Day ${day + 1}`,
        tournamentDate: archiveDate(((index * volumes.tournamentsPerLeague + day) % ARCHIVE_WEEKS) * 7),
        status,
        rounds,
        playerArchetypes: roster.map((playerName) => ({ playerName, archetype: pick(random, archetypes) }))
      });
    }

    leagues.push({
      id: leagueId,
      name: `Stress League ${pad(index, 3)}`,
      status: index % 2 === 0 ? 'completed' : 'active',
      tournaments
    });
  }
  return leagues;
}

function generateLiveTournaments(random, volumes, organizers, leagues, pool, archetypes) {
  const live = [];
  for (let index = 0; index < volumes.liveTournaments; index += 1) {
    const roundCount = 3;
    live.push({
      key: `stress-live-${pad(index, 2)}`,
      organizerEmail: organizers[index % organizers.length].email,
      name: `Stress Live Tournament ${pad(index, 2)}`,
      leagueKey: index % 3 === 0 ? null : leagues[index % leagues.length].id,
      tournamentDate: { offsetDays: 0 },
      roundCount,
      customRoundCount: true,
      paidTrackingEnabled: index % 2 === 0,
      scoredRounds: index % roundCount,
      leaveRoundOpen: index % 2 === 1,
      players: distinctPlayers(random, pool, 8).map((name) => ({
        name,
        initialWins: 0,
        initialDraws: 0,
        initialLosses: 0,
        archetype: pick(random, archetypes)
      }))
    });
  }
  return live;
}

/**
 * Audit rows, capped (A10). They carry no id: `scripts/bulk-load-stress.mjs` mints one per row, and the
 * timestamp is a negative minute offset rendered against the seeding clock, so a dataset generated once
 * still reads as recent activity months later.
 */
function generateAuditRecords(random, volumes, accounts) {
  const records = [];
  const capped = Math.min(volumes.auditRecords, STRESS_VOLUMES.auditRecords);
  for (let index = 0; index < capped; index += 1) {
    const [action, entityType] = pick(random, AUDIT_ACTIONS);
    const account = pick(random, accounts);
    records.push({
      // A tenth of the rows are actorless, the shape a hard account deletion leaves behind.
      actorEmail: index % 10 === 0 ? null : account.email,
      action,
      entityType,
      entityId: `stress-${entityType}-${pad(index % 500, 3)}`,
      redactedDiff: index % 3 === 0 ? {} : { fields: ['stressField'], index },
      occurredAtOffsetMinutes: -between(random, 1, 60 * 24 * 180)
    });
  }
  return records;
}

/** The whole dataset, in memory. `scale` below 1 is for tests; the seeder always generates at 1. */
export function generateStressEnvironment({ seed = DEFAULT_SEED, scale = 1, root = process.cwd() } = {}) {
  const random = mulberry32(seed);
  const volumes = scaledVolumes(scale);
  const archetypes = readArchetypes(root);
  const pool = playerNamePool(volumes.playerPool);

  const accounts = generateAccounts(random, volumes);
  const organizers = accounts.filter((account) => account.role === 'Organizer');
  const registrable = accounts.filter((account) => account.role === 'User' && account.emailConfirmed !== false);
  const organizations = generateOrganizations(random, volumes, organizers);
  const formats = generateFormats(volumes);
  const tournaments = generateEvents(random, volumes, organizations, formats);
  const registrations = generateRegistrations(random, volumes, tournaments, registrable);
  const leagues = generateLeagues(random, volumes, pool, archetypes);
  const liveTournaments = generateLiveTournaments(random, volumes, organizers, leagues, pool, archetypes);
  const auditRecords = generateAuditRecords(random, volumes, accounts);

  return { accounts, organizations, formats, tournaments, registrations, leagues, liveTournaments, auditRecords };
}

/** One file per dataset key, in the shape `readEnvironment` expects. Returns the paths written. */
export function writeStressEnvironment(data, directory = STRESS_DIRECTORY) {
  mkdirSync(directory, { recursive: true });
  const files = [
    ['accounts.json', data.accounts],
    ['organizations.json', data.organizations],
    ['formats.json', data.formats],
    ['tournaments.json', data.tournaments],
    ['registrations.json', data.registrations],
    ['leagues.json', data.leagues],
    ['live-tournaments.json', data.liveTournaments],
    [AUDIT_FILE, data.auditRecords]
  ];
  const written = [];
  for (const [file, rows] of files) {
    const path = join(directory, file);
    writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
    written.push(path);
  }
  return written;
}

/** Reads the audit rows the bulk loader needs; `readEnvironment` only knows the `DATA_FILES` keys. */
export function readStressAuditRecords(directory = STRESS_DIRECTORY) {
  return JSON.parse(readFileSync(join(directory, AUDIT_FILE), 'utf8'));
}

export function parseSeed(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--seed=')) return Number(argument.slice('--seed='.length));
    if (argument === '--seed') return Number(argv[index + 1]);
  }
  return DEFAULT_SEED;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const seed = parseSeed(process.argv.slice(2));
  if (!Number.isInteger(seed) || seed < 0) {
    console.error(`--seed must be a non-negative integer, got "${seed}".`);
    process.exit(2);
  }

  const data = generateStressEnvironment({ seed });
  const written = writeStressEnvironment(data);
  console.log(`Generated the "${STRESS_ENVIRONMENT}" environment from seed ${seed}:`);
  console.log([
    `  ${data.accounts.length} accounts`,
    `  ${data.organizations.length} organizations`,
    `  ${data.formats.length} formats`,
    `  ${data.tournaments.length} Events`,
    `  ${data.registrations.length} registrations`,
    `  ${data.leagues.length} League Archives (${data.leagues.reduce((total, league) => total + league.tournaments.length, 0)} Archive Tournaments)`,
    `  ${data.liveTournaments.length} running tournaments`,
    `  ${data.auditRecords.length} audit rows`
  ].join('\n'));
  console.log(`\nWrote ${written.length} files to ${STRESS_DIRECTORY}. Load it with: npm run dev -- --env=${STRESS_ENVIRONMENT}`);
}
