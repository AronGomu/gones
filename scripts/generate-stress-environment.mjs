#!/usr/bin/env node
/**
 * Writes the `stress` development environment: a simulation of the French tournament circuit,
 * generated from a seeded PRNG (T29, ADR 0030).
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
 *
 * ## The archive is three-tier
 *
 * League -> League Season -> Tournament, with a Tournament free to stand alone (`seasonId: null`). A
 * **Season name is a free string**, never a year column: the public record labels seasons `2026`,
 * `2025-26`, `Season 3`, `Season 5 - Round 2`, `2026/2` and `3ª Etapa Regular - 2026/2`, which is what
 * {@link SEASON_LABEL_STYLES} draws from. The tournaments-per-Season spread comes from the observed
 * size classes in {@link SEASON_SIZE_CLASSES} — a World Championship is one event, a late Grand Prix
 * season is sixty — so the archive pages are judged against the real range and not a middling Season.
 *
 * A running tournament's `leagueKey` names a LeagueSeason of the three-tier archive: the legacy flat
 * League it used to name is retired (T19), and with it `leagues.json`.
 *
 * Archive dates are measured against {@link ARCHIVE_ANCHOR_DATE}, not the clock, so the dataset stays
 * byte-identical from one day to the next — and therefore **ages**: past roughly mid-2027 every
 * generated Tournament is inside the 365-day lock window. Refreshing it means moving the anchor and the
 * epoch forward together.
 *
 * ## What it simulates
 *
 * Four tiers of event, the shape of the real French circuit:
 *
 * | tier | cadence | field | who runs it |
 * | --- | --- | --- | --- |
 * | local | weekly | 8-30 | every club, in its own weekly slot |
 * | monthly | monthly | 30-100 | the clubs with a monthly Open |
 * | regional | every 2 months | 100-300 | each région, host club rotating |
 * | national | yearly | 1000+ | one Championnat de France, with its satellites |
 *
 * The cities, their postal codes, the field sizes, the format mix, the deck archetypes and the
 * club-activity spread were all read off the real thing: 886 French paper events published on
 * mtgtop8.com between 2025-01-28 and 2026-08-20 (all formats, 264 venues, 172 cities). The measured
 * field sizes are 75% at 8-30 players, 21% at 31-100, 3% at 101-300 and 1% above 300, and the measured
 * top-8 recurrence is a core of a dozen players taking about half the seats of a weekly local with a
 * long tail of one-off entrants behind them — which is what {@link CLUB_ROSTER_WEIGHTS} reproduces.
 *
 * **Everything about a person is synthetic.** No player name, score, account or club name comes from
 * that survey; only public facts about places, formats, deck archetypes and event sizes do. The club
 * names are generated from French game-shop naming patterns rather than copied, so no real shop is
 * named as the host of results it never ran.
 *
 * **Weekdays are a rhythm, not a day.** A Calendar offset is relative to whatever day the seeding runs,
 * so this file cannot know that offset -14 is a Thursday. What it guarantees is that every club's local
 * repeats on the same weekday (its offsets are congruent modulo 7) and that the bigger events sit on a
 * different, shared slot. The archive dates are absolute, so those do carry real weekdays.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STRESS_ENVIRONMENT = 'stress';
export const STRESS_DIRECTORY = join('fixtures', 'dev-environments', STRESS_ENVIRONMENT);
export const AUDIT_FILE = 'audit-records.json';
export const DEFAULT_SEED = 1;

/**
 * The circuit this generates, sized so the dataset stays in the weight class the environment exists
 * for: ~700 accounts to register, ~200 organizations, ~200 League Archives and a five-figure Event
 * count. Running tournaments are the deliberate exception (round 2 Q6): they are replayed through the
 * real Live commands one command at a time, so they are capped at ten however far the rest scales.
 */
export const STRESS_VOLUMES = {
  clubs: 200,
  /** Clubs running a true weekly local. The rest still have a weekly slot, they just use it less. */
  weeklyClubs: 12,
  /** Clubs whose slot fires about twice a month, and which also run a monthly Open. */
  monthlyClubs: 36,
  /** Weeks a club that is neither of the above waits between two of its locals. */
  occasionalWeeksBetweenLocals: 13,
  /** Seasons of archived history per archive League. One calendar year each, newest against the anchor. */
  archiveSeasons: 3,
  /** Tournaments that belong to no Season. The archive is full of one-off events with no series. */
  standaloneTournaments: 120,
  admins: 5,
  users: 450,
  unverifiedUsers: 100,
  playerPool: 2400,
  liveTournaments: 10,
  auditRecords: 10000
};

/** Events land between fourteen months back and the horizon each tier publishes at, today included. */
const PAST_DAYS = 420;
/** How far ahead a tier is published. A shop announces next week's local, not next year's. */
const FUTURE_DAYS = { local: 56, monthly: 91, regional: 182, national: 91 };
/** A year, in whole weeks, so the two national editions land on the same slot twelve months apart. */
const NATIONAL_YEAR_DAYS = 364;

/** Archive Tournaments are history, so their dates are absolute and counted off this fixed Monday. */
const ARCHIVE_EPOCH = Date.UTC(2023, 0, 2);

/** The declared "today" every generated archive date is measured against. Absolute and clock-free: the
 * generator must stay byte-deterministic, so the lock window cannot be read off the wall clock. */
export const ARCHIVE_ANCHOR_DATE = '2026-08-22';

/**
 * The domain refuses a Tournament document over this on read (`ArchiveTournament.MaximumDocumentBytes`),
 * and the bulk loader writes rows the domain never validated — so a document generated over the limit
 * would only surface as a crashed statistics rebuild. `assertTournamentBudget` keeps a margin under it.
 * The megabyte is per Tournament now, not per League.
 */
export const MAXIMUM_TOURNAMENT_BYTES = 1_048_576;
const TOURNAMENT_BYTE_BUDGET = Math.floor(MAXIMUM_TOURNAMENT_BYTES * 0.9);

const FIRST_NAMES = [
  'Alix', 'Bastien', 'Camille', 'Damien', 'Elodie', 'Fabien', 'Gaelle', 'Hugo', 'Ines', 'Julien',
  'Karim', 'Louise', 'Maxime', 'Nadia', 'Olivier', 'Perrine', 'Quentin', 'Romain', 'Sabine', 'Thibault',
  'Ulysse', 'Valentine', 'Wassim', 'Xavier', 'Yasmine', 'Zoe', 'Amaury', 'Benoit', 'Clarisse', 'Dorian',
  'Emeric', 'Flavie', 'Gaspard', 'Helene', 'Ismael', 'Joachim', 'Klara', 'Lucien', 'Margaux', 'Noe',
  'Ombeline', 'Pacome', 'Quitterie', 'Raphael', 'Solene', 'Tristan', 'Ursule', 'Victor', 'Wilfried', 'Yann',
  'Anouk', 'Baptiste', 'Cyprien', 'Diane', 'Enzo', 'Faustine', 'Gauthier', 'Hortense', 'Ivan', 'Jonas'
];

const LAST_NAMES = [
  'Aubert', 'Bonnet', 'Chartier', 'Delaunay', 'Estivals', 'Fournier', 'Guerin', 'Hamon', 'Imbert', 'Jourdan',
  'Kessler', 'Lacombe', 'Marchand', 'Noiret', 'Ollivier', 'Peyron', 'Quesnel', 'Rambaud', 'Sabatier', 'Tessier',
  'Urbain', 'Vasseur', 'Weber', 'Ybert', 'Zamora', 'Andrieu', 'Bosc', 'Cadiou', 'Dubreuil', 'Escoffier',
  'Fayolle', 'Gontier', 'Huguet', 'Isnard', 'Jaillet', 'Larcher', 'Mounier', 'Nivelle', 'Odin', 'Pruvost',
  'Rossignol', 'Salvador', 'Thibaud', 'Vionnet', 'Wattelier'
];

/**
 * The French scene by région, in the order the survey ranks them, each with the cities that really host
 * events and their real postal codes. The trailing number is that city's share of the surveyed events
 * and is what places the clubs: Paris and Lyon get several, Vendôme gets one that fires four times a
 * year. Corse carries no surveyed event and is therefore absent rather than invented.
 */
const FRANCE = [
  ['Auvergne-Rhône-Alpes', [['Lyon', '69001', 78], ['Chambéry', '73000', 13], ['Clermont-Ferrand', '63000', 8], ['Roanne', '42300', 7], ['Thonon-les-Bains', '74200', 6], ['Villeurbanne', '69100', 4]]],
  ['Île-de-France', [['Paris', '75001', 80], ['Nogent-sur-Marne', '94130', 20], ['Montigny-le-Bretonneux', '78180', 12], ['Antony', '92160', 6], ['Rambouillet', '78120', 4], ['Palaiseau', '91120', 4]]],
  ['Normandie', [['Rouen', '76000', 55], ['Caen', '14000', 23], ['Basly', '14610', 22], ['Lisieux', '14100', 13], ['Amayé-sur-Orne', '14210', 10], ['Cairon', '14610', 3]]],
  ['Occitanie', [['Toulouse', '31000', 34], ['Montpellier', '34000', 15], ['Cahors', '46000', 10], ['Narbonne', '11100', 9], ['Gigean', '34770', 6], ['Muret', '31600', 5]]],
  ['Provence-Alpes-Côte d\'Azur', [['Toulon', '83000', 22], ['Nice', '06000', 22], ['Mandelieu-la-Napoule', '06210', 12], ['Antibes', '06160', 9], ['Grasse', '06130', 3], ['Puget-sur-Argens', '83480', 2]]],
  ['Nouvelle-Aquitaine', [['Bordeaux', '33000', 21], ['Talence', '33400', 10], ['La Teste-de-Buch', '33115', 10], ['Eysines', '33320', 6], ['Châtellerault', '86100', 4], ['Layrac', '47390', 3]]],
  ['Centre-Val de Loire', [['Châteauroux', '36000', 16], ['Tours', '37000', 13], ['Chartres', '28000', 8], ['Bourges', '18000', 7], ['Orléans', '45000', 2], ['Vendôme', '41100', 1]]],
  ['Grand Est', [['Strasbourg', '67000', 15], ['Reims', '51100', 10], ['Ohlungen', '67170', 4], ['Lingolsheim', '67380', 3], ['Troyes', '10000', 2], ['Nancy', '54000', 1]]],
  ['Bretagne', [['Rennes', '35000', 15], ['Saint-Malo', '35400', 8], ['Brest', '29200', 2], ['Lannion', '22300', 1], ['Pontivy', '56300', 1], ['Trégueux', '22950', 1]]],
  ['Hauts-de-France', [['Lille', '59000', 8], ['Calais', '62100', 4], ['Soissons', '02200', 3], ['Hazebrouck', '59190', 2], ['Montdidier', '80500', 2], ['Bergues', '59380', 2]]],
  ['Pays de la Loire', [['Angers', '49000', 8], ['Le Mans', '72000', 6], ['Nantes', '44000', 4], ['Orvault', '44700', 2], ['Les Herbiers', '85500', 1], ['Saint-Nazaire', '44600', 1]]],
  ['Bourgogne-Franche-Comté', [['Besançon', '25000', 7], ['Cosne-Cours-sur-Loire', '58200', 1], ['Montbéliard', '25200', 1]]]
];

/** The national event's home. Châteauroux really is where the Championnat de France is played. */
const NATIONAL_CITY = ['Châteauroux', '36000', 'Centre-Val de Loire'];
/** The two editions the window covers, the archive one and the one on the Calendar. */
const NATIONAL_YEARS = [2025, 2026];

/**
 * The format catalog is the real French one, weighted by its surveyed share: Duel Commander is most of
 * the paper circuit, Legacy is the next block, and the rest trails off. The archetypes are the decks
 * those events really registered — except Legacy, which reads the app's own preset list so the archive
 * archetypes are the ones the autocomplete recognises.
 */
const FORMATS = [
  { key: 'stress-format-duel-commander', name: 'Duel Commander', slug: 'duel-commander', weight: 61, archetypes: ['Slimefoot and Squee', 'Aragorn, King of Gondor', 'Phelia, Exuberant Shepherd', 'Tasigur, the Golden Fang', 'Atraxa, Grand Unifier', 'Lumra, Bellow of the Woods', 'Glarb, Calamity\'s Augur', 'Hidetsugu and Kairi', 'Quintorius, History Chaser', 'Light-paws, Emperor\'s Voice', 'Ertai Resurrected', 'Satya, Aetherflux Genius'] },
  { key: 'stress-format-legacy', name: 'Legacy', slug: 'legacy', weight: 17, archetypes: null },
  { key: 'stress-format-pauper', name: 'Pauper', slug: 'pauper', weight: 8, archetypes: ['Grixis Affinity', 'Elves', 'Dimir Control', 'Urzatron', 'Madness Burn', 'Mono Red Rally', 'Mono Blue Delver', 'Jund Wildfire', 'Balustrade Spy', 'Red Deck Wins', 'Golgari Pestilence', 'Turbo Fog'] },
  { key: 'stress-format-modern', name: 'Modern', slug: 'modern', weight: 6, archetypes: ['Affinity', 'Boros Energy', 'Jeskai Blink', 'Domain Zoo', 'Eldrazi Ramp', 'Amulet Titan', 'Izzet Prowess', 'Esper Goryo', 'Living End', 'Belcher', 'Tron', 'Yawgmoth'] },
  { key: 'stress-format-premodern', name: 'Premodern', slug: 'premodern', weight: 5, archetypes: ['Stiflenought', 'Landstill', 'Enchantress', 'Deadguy Ale', 'Terrageddon', 'Goblins', 'Replenish', 'The Rock', 'Burn', 'Full English Breakfast'] },
  { key: 'stress-format-standard', name: 'Standard', slug: 'standard', weight: 3, archetypes: ['Izzet Lessons', 'Simic Nature\'s Rhythm', 'Dimir Midrange', 'Jeskai Control', 'Mono Green Landfall', 'Dimir Aggro', 'Boros Aggro', 'Mono Red Aggro', 'Orzhov Demon', 'Gruul Aggro'] },
  { key: 'stress-format-cedh', name: 'cEDH', slug: 'cedh', weight: 2, archetypes: ['Kinnan, Bonder Prodigy', 'Magda, Brazen Outlaw', 'Rocco, Cabaretti Caterer', 'Talion, the Kindly Lord', 'Yuriko, the Tiger\'s Shadow', 'Karlov of the Ghost Council', 'Ojer Axonil, Deepest Might'] },
  { key: 'stress-format-pioneer', name: 'Pioneer', slug: 'pioneer', weight: 2, archetypes: ['Izzet Phoenix', 'Rakdos Demon', 'Esper Control', 'Gruul Aggro', 'Orzhov Ketramose', 'Azorius Flash'] },
  { key: 'stress-format-vintage', name: 'Vintage', slug: 'vintage', weight: 1, archetypes: ['Bazaar Aggro', 'Doomsday', 'Jeskai Xerox', 'Oath of Druids', 'Paradoxical Outcome', 'Underworld Breach'] }
];

/**
 * French game-shop naming, the two halves kept apart so a club name is a draw and not a copy. The
 * article travels with the noun: "Le Fabrique" is not a name a French shop would put on its door.
 */
const CLUB_WORDS = [
  'Le Repaire', 'Le Comptoir', 'Le Cercle', 'La Taverne', 'L\'Atelier', 'La Guilde', 'L\'Antre', 'La Halle',
  'La Fabrique', 'La Manufacture', 'La Ludothèque', 'L\'Échoppe', 'L\'Arène', 'Le Sanctuaire', 'La Cabane', 'La Forge'
];
const CLUB_SUFFIXES = [
  'des Brasseurs', 'du Dé', 'des Cartonneurs', 'à Jeux', 'du Mana', 'des Planeswalkers', 'de l\'Éclair',
  'du Grimoire', 'des Tapis Verts', 'du Kraken', 'des Gobelins', 'de la Cale', 'du Vieux Monde', 'des Runes'
];
/** Clubs that read as an acronym or a coined word, the other half of the real naming spread. */
const CLUB_COINED = [
  'Manaflux', 'Cartazur', 'Ludotop', 'Deckstop', 'Tapverts', 'Mulligan', 'Sideboard', 'Foudroyeurs',
  'Cartonneo', 'Splashzone', 'Bibliomana', 'Topdeck', 'Kartomania', 'Draftline', 'Sagaludo', 'Vortex'
];

const STREETS = [
  'rue de la République', 'avenue Jean Jaurès', 'cours Lafayette', 'quai Saint-Antoine', 'rue Victor Hugo',
  'place Bellecour', 'rue Gambetta', 'boulevard Voltaire', 'rue des Capucins', 'avenue de la Gare'
];

/**
 * The recurring series names the survey found, generic enough to belong to no one shop: a weekly is a
 * "Weekly", a "Ligue" manche or a "Tournoi Hebdo", a monthly is an Open or an RCQ, the bi-monthly is the
 * région's Championnat Régional, and the yearly one is the Championnat de France and its satellites.
 */
const LOCAL_SERIES = ['Weekly', 'Ligue', 'Tournoi Hebdo', 'Soirée', 'League Night'];
const MONTHLY_SERIES = ['Open', 'RCQ', 'Qualifier CdF', 'Grand Tournoi', 'Trial'];
const NATIONAL_SATELLITES = ['Warm Up', 'Chill #1', 'Chill #2', 'Chill #3', 'Rebound', 'Last Chance'];

/**
 * Tournaments a Season really runs, as the public archives report it. Weights sum to 97.
 *
 * The weights are the volume knob: the régional and national Leagues take the class they are, so only
 * the club Leagues draw, and `lateGrandPrix` is what carries the mean up to the ~2200 Tournaments the
 * environment is sized for.
 */
export const SEASON_SIZE_CLASSES = [
  { key: 'championship',   minimum: 1,  maximum: 1,  weight: 4 },   // a World Championship is one event
  { key: 'proTour',        minimum: 3,  maximum: 4,  weight: 10 },  // the modern Pro Tour
  { key: 'regional',       minimum: 6,  maximum: 6,  weight: 8 },   // Regional Championships
  { key: 'spotlight',      minimum: 8,  maximum: 11, weight: 12 },  // Spotlight Series
  { key: 'earlyGrandPrix', minimum: 5,  maximum: 13, weight: 18 },  // Grand Prix, early seasons
  { key: 'weekly',         minimum: 7,  maximum: 20, weight: 40 },  // a store league's weekly legs
  { key: 'lateGrandPrix',  minimum: 50, maximum: 60, weight: 5 }    // Grand Prix, late seasons
];

/** How a real Season labels itself. A Season name is a FREE STRING; none of these is a year column. */
export const SEASON_LABEL_STYLES = [
  { key: 'year',        weight: 34 },  // "2025"
  { key: 'crossYear',   weight: 14 },  // "2025-26" — autumn-to-spring, or August-to-August
  { key: 'numbered',    weight: 18 },  // "Season 3"
  { key: 'numberedLeg', weight: 10 },  // "Season 5 - Round 2"
  { key: 'yearSlash',   weight: 12 },  // "2026/2"
  { key: 'ordinalLeg',  weight: 8 },   // "3ª Etapa Regular - 2026/2"
  { key: 'namedLeg',    weight: 4 }    // "<League name> - Primeira Etapa"
];

/** Names carrying no series signal at all. These must become standalone Tournaments, never Leagues. */
export const DEGENERATE_TOURNAMENT_NAMES = ['Series', '1K', 'FNM', 'Weekly'];

/** Series names the generated archive borrows from the public record, diacritics included. */
const ARCHIVE_SERIES_WORDS = ['Ligue', 'Circuit', 'Championnat', 'Tournoi', 'Étape', 'Liga Sword', 'Spotlight Series'];
/** The one child series whose name embeds its parent's, so prefix-grouping heuristics visibly break. */
const EMBEDDED_CHILD_SUFFIX = ' - 2nd Chance PTQ';

/**
 * A club roster is a core, the regulars behind it and the occasional entrants who show up a few times a
 * season. The weights are the odds of any one of them taking a seat, and they are what reproduces the
 * measured shape of a real local: about a dozen names take half the seats, and the tail behind them is
 * mostly players seen once.
 */
const CLUB_ROSTER_WEIGHTS = { core: 20, regular: 3, occasional: 1 };
const CLUB_ROSTER_SIZES = { core: 14, regular: 26, occasional: 60 };

/** Field sizes per tier, and the exponent that bends a uniform draw onto the surveyed median. */
const TIERS = {
  local: { minimum: 8, maximum: 30, skew: 1.3, capacity: 32 },
  monthly: { minimum: 30, maximum: 100, skew: 2.2, capacity: 104 },
  regional: { minimum: 100, maximum: 300, skew: 2.0, capacity: 320 },
  national: { minimum: 1000, maximum: 1100, skew: 1, capacity: null }
};

/** Swiss rounds a field of this size is really paired for. */
const ROUND_LADDER = [[8, 3], [16, 4], [32, 5], [64, 6], [128, 7], [256, 8], [1400, 9]];

/** The national weekend: the whole field plays these, then a quarter of it comes back for these. */
const NATIONAL_DAY_ONE_ROUNDS = 6;
const NATIONAL_DAY_TWO_ROUNDS = 3;

/** Match results, weighted the way a Swiss round really falls: few draws, most wins on the third game. */
const RESULTS = [[[2, 0], 30], [[2, 1], 26], [[0, 2], 22], [[1, 2], 14], [[1, 1], 8]];

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

/** One draw from `[value, weight]` pairs. */
function weighted(random, entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let target = random() * total;
  for (const [value, weight] of entries) {
    target -= weight;
    if (target <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const slugify = (value) => value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/** The Legacy archetypes, taken from the JSON twin of `legacy-archetype-presets.ts`. */
function readLegacyArchetypes(root = process.cwd()) {
  const presets = JSON.parse(readFileSync(join(root, 'src/assets/config/legacy-archetype-presets.json'), 'utf8'));
  return presets.archetypes.slice(0, 40);
}

/**
 * A fixed pool of synthetic player names, first names crossed with surnames in a stable order. The pool
 * is fixed rather than drawn so the seed only decides who plays where: rankings and player pages need a
 * bounded cast that recurs across Leagues, not a fresh name per Match. The two lists cross to 2700
 * distinct names, which is the ceiling on `playerPool`.
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
 * Weighted sampling without replacement (Efraimidis-Spirakis): every candidate draws a key from its own
 * exponential, and the `size` smallest keys win. One pass, no rejection loop, and a core player is
 * twelve times likelier to take a seat than a one-off entrant without ever taking two.
 */
function drawField(random, candidates, size) {
  const keyed = candidates.map((candidate) => ({
    name: candidate.name,
    key: -Math.log(1 - random()) / candidate.weight
  }));
  keyed.sort((left, right) => (left.key === right.key ? left.name.localeCompare(right.name) : left.key - right.key));
  return keyed.slice(0, Math.min(size, keyed.length)).map((candidate) => candidate.name);
}

/** A field size for a tier: uniform bent by the tier's exponent onto the surveyed median. */
function fieldSize(random, tier) {
  const { minimum, maximum, skew } = TIERS[tier];
  return minimum + Math.floor((maximum - minimum + 1) * random() ** skew);
}

function roundsFor(players) {
  for (const [ceiling, rounds] of ROUND_LADDER) if (players <= ceiling) return rounds;
  return ROUND_LADDER[ROUND_LADDER.length - 1][1];
}

/** `YYYY-MM-DD`, `days` after the fixed archive epoch. Absolute on purpose: an archive is history. */
function archiveDate(days) {
  const date = new Date(ARCHIVE_EPOCH + days * 86400000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

function scaledVolumes(scale) {
  const scaled = (value) => Math.max(1, Math.round(value * scale));
  const clubs = scaled(STRESS_VOLUMES.clubs);
  // The two active classes are a prefix of the club list, so they are clamped to what is left of it.
  const weeklyClubs = Math.min(clubs, scaled(STRESS_VOLUMES.weeklyClubs));
  return {
    ...STRESS_VOLUMES,
    clubs,
    weeklyClubs,
    monthlyClubs: Math.min(clubs - weeklyClubs, scaled(STRESS_VOLUMES.monthlyClubs)),
    admins: scaled(STRESS_VOLUMES.admins),
    users: scaled(STRESS_VOLUMES.users),
    unverifiedUsers: Math.min(scaled(STRESS_VOLUMES.unverifiedUsers), scaled(STRESS_VOLUMES.users) - 1),
    playerPool: scaled(STRESS_VOLUMES.playerPool),
    auditRecords: scaled(STRESS_VOLUMES.auditRecords),
    archiveSeasons: Math.min(STRESS_VOLUMES.archiveSeasons, scaled(STRESS_VOLUMES.archiveSeasons)),
    standaloneTournaments: scaled(STRESS_VOLUMES.standaloneTournaments),
    // Ten Live command replays is already the slowest part of a seed; scaling down is allowed, up is not.
    liveTournaments: Math.min(STRESS_VOLUMES.liveTournaments, scaled(STRESS_VOLUMES.liveTournaments))
  };
}

/**
 * The clubs, placed on the map the way the survey found them: the cities that host the most events get
 * the most clubs, and the first `weeklyClubs` of them — the ones in the busiest cities — are the scenes
 * that really run something every week. Each club owns a weekly slot (a residue modulo 7, the rhythm a
 * Calendar offset can carry) and a home format drawn on the real format mix.
 */
function generateClubs(random, volumes, formats) {
  const slots = [];
  for (const [region, cities] of FRANCE) {
    for (const [city, postalCode, share] of cities) slots.push({ region, city, postalCode, share });
  }
  // Most-visited city first, so club 0 lands in Paris or Lyon and the tail lands in Vendôme.
  slots.sort((left, right) => (right.share === left.share ? left.city.localeCompare(right.city) : right.share - left.share));

  const totalShare = slots.reduce((sum, slot) => sum + slot.share, 0);
  const placements = [];
  for (const slot of slots) {
    const count = Math.max(1, Math.round((slot.share / totalShare) * volumes.clubs));
    for (let index = 0; index < count; index += 1) placements.push(slot);
  }
  // Round-half-up across sixty cities never lands exactly on the target; the ends absorb the difference.
  while (placements.length > volumes.clubs) placements.pop();
  while (placements.length < volumes.clubs) placements.push(slots[placements.length % slots.length]);

  const formatWeights = formats.map((format) => [format, format.weight]);
  const taken = new Set();
  const clubs = [];
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const activity = index < volumes.weeklyClubs
      ? 'weekly'
      : index < volumes.weeklyClubs + volumes.monthlyClubs ? 'monthly' : 'occasional';
    const drawn = random() < 0.35
      ? `${pick(random, CLUB_COINED)} ${placement.city}`
      : `${pick(random, CLUB_WORDS)} ${pick(random, CLUB_SUFFIXES)}`;
    // Two clubs drawing the same words is common at this volume, and a name has to be unique: it is
    // what keeps the Event titles unique, and two Events sharing a title are read as one split Event.
    // The city is the first tiebreak, the way a chain really names its second shop; the index is the
    // last resort.
    const tiebreak = drawn.endsWith(placement.city) ? `${drawn} ${pad(index, 3)}` : `${drawn} ${placement.city}`;
    const name = [drawn, tiebreak, `${drawn} ${pad(index, 3)}`].find((candidate) => !taken.has(candidate));
    taken.add(name);

    clubs.push({
      key: `stress-club-${pad(index, 3)}`,
      name,
      city: placement.city,
      postalCode: placement.postalCode,
      region: placement.region,
      activity,
      // The weekly slot. Distinct residues spread the locals over the week the way the survey does.
      weekdaySlot: index % 7,
      format: weighted(random, formatWeights),
      streetAddress: `${between(random, 1, 180)} ${pick(random, STREETS)}`,
      index
    });
  }
  return clubs;
}

/**
 * Rosters are drawn from a slice of the pool that follows the club's own index, so neighbouring clubs
 * overlap and a player who travels one région over is a name the archive already knows. The core is what
 * makes a local look like a local: the same dozen faces, week after week.
 */
function assignRosters(random, clubs, pool, archetypesFor) {
  const size = CLUB_ROSTER_SIZES.core + CLUB_ROSTER_SIZES.regular + CLUB_ROSTER_SIZES.occasional;
  const stride = Math.max(1, Math.floor(pool.length / Math.max(1, clubs.length)));

  for (const club of clubs) {
    const roster = [];
    for (let offset = 0; offset < size; offset += 1) {
      const name = pool[(club.index * stride + offset) % pool.length];
      const tier = offset < CLUB_ROSTER_SIZES.core
        ? 'core'
        : offset < CLUB_ROSTER_SIZES.core + CLUB_ROSTER_SIZES.regular ? 'regular' : 'occasional';
      roster.push({ name, weight: CLUB_ROSTER_WEIGHTS[tier], tier });
    }
    club.roster = roster;
    // A player brings a deck, not a fresh archetype per Match: the pet deck is fixed here and reused.
    club.decks = new Map(roster.map((player) => [player.name, pick(random, archetypesFor(club.format))]));
  }
}

function generateAccounts(random, volumes, clubs) {
  const accounts = [];
  const person = () => ({ firstName: pick(random, FIRST_NAMES), lastName: pick(random, LAST_NAMES) });

  for (let index = 0; index < volumes.admins; index += 1) {
    accounts.push({ email: `stress-admin-${pad(index, 3)}@gones.test`, username: `stress-admin-${pad(index, 3)}`, ...person(), role: 'Admin' });
  }
  // One tournament organizer per club, and a second for the clubs that run more than a weekly.
  let organizerIndex = 0;
  for (const club of clubs) {
    club.organizerEmails = [];
    const count = club.activity === 'occasional' ? 1 : 2;
    for (let seat = 0; seat < count; seat += 1) {
      const email = `stress-organizer-${pad(organizerIndex, 3)}@gones.test`;
      accounts.push({ email, username: `stress-organizer-${pad(organizerIndex, 3)}`, ...person(), role: 'Organizer' });
      club.organizerEmails.push(email);
      organizerIndex += 1;
    }
  }
  for (let index = 0; index < volumes.users; index += 1) {
    const account = { email: `stress-user-${pad(index, 3)}@gones.test`, username: `stress-user-${pad(index, 3)}`, ...person(), role: 'User' };
    // The unverified block sits at the end so every earlier index stays registerable for content.
    if (index >= volumes.users - volumes.unverifiedUsers) account.emailConfirmed = false;
    accounts.push(account);
  }
  return accounts;
}

function generateOrganizations(clubs) {
  return clubs.map((club) => ({
    key: club.key,
    name: club.name,
    description: `${club.name}, ${club.city} — ${club.activity === 'occasional' ? 'tournois ponctuels' : 'locale hebdomadaire'} en ${club.format.name}.`,
    website: `https://${slugify(club.name)}.test`,
    contactEmail: `contact@${slugify(club.name)}.test`,
    memberEmails: [...club.organizerEmails]
  }));
}

function generateFormats() {
  return FORMATS.map((format, index) => ({
    key: format.key,
    name: format.name,
    slug: format.slug,
    sortOrder: (index + 1) * 10
  }));
}

/** `-PAST_DAYS <= offset` and on the club's own weekday slot: `weekOffset` weeks from this week's slot. */
function slotOffset(club, weekOffset) {
  return weekOffset * 7 + (club.weekdaySlot - 3);
}

/**
 * Every local a club runs over the window. A weekly club fires every week, a monthly one every other
 * week and the rest once a quarter — the spread the survey found behind its 264 venues. A few weeks fall
 * off whatever the club is: France closes in August and between Christmas and New Year.
 */
function localWeeks(random, club, volumes) {
  const step = club.activity === 'weekly' ? 1 : club.activity === 'monthly' ? 2 : volumes.occasionalWeeksBetweenLocals;
  const first = -Math.floor(PAST_DAYS / 7);
  const last = Math.floor(FUTURE_DAYS.local / 7);
  const weeks = [];
  for (let week = first; week <= last; week += step) {
    if (club.activity !== 'occasional' && random() < 0.08) continue;
    weeks.push(week);
  }
  return weeks;
}

const summarize = (value) => (value.length <= 50 ? value : `${value.slice(0, 47)}...`);

function eventBody(format, club, tierLabel) {
  return `<p>${tierLabel} en ${format.name} chez ${club.name}, ${club.city}.</p>`
    + '<ul><li>Ronde 1 à l\'heure annoncée</li><li>Decklists obligatoires au-delà de 32 joueurs</li></ul>';
}

/**
 * The Calendar: every local, monthly Open, Championnat Régional and Championnat de France the circuit
 * runs across the window. Titles carry the club or the région plus an edition number, which is what
 * keeps them unique — two Events sharing a title are read as one split Event by `validateEnvironment`.
 */
function generateEvents(random, volumes, clubs, formatsByKey) {
  const events = [];
  const push = (event) => { events.push(event); return event; };

  for (const club of clubs) {
    const series = pick(random, LOCAL_SERIES);
    let edition = 1;
    for (const week of localWeeks(random, club, volumes)) {
      const offset = slotOffset(club, week);
      if (offset < -PAST_DAYS || offset > FUTURE_DAYS.local) continue;
      const title = `${club.name} ${series} #${pad(edition, 3)}`;
      const start = 19 + (club.index % 2);
      push({
        key: `stress-local-${club.key.slice(-3)}-${pad(edition, 3)}`,
        organizationKey: club.key,
        organizerEmail: club.organizerEmails[0],
        title,
        summary: summarize(`${club.format.name} — locale ${club.city}`),
        bodyHtml: eventBody(club.format, club, 'Locale hebdomadaire'),
        streetAddress: club.streetAddress,
        postalCode: club.postalCode,
        city: club.city,
        country: 'France',
        region: club.region,
        eventType: 'weekly',
        timeZoneId: 'Europe/Paris',
        startsAtLocalOffsetDays: offset,
        startsAtLocalTime: `${pad(start, 2)}:00`,
        endsAtLocalOffsetDays: offset,
        endsAtLocalTime: '23:30',
        capacity: TIERS.local.capacity,
        formatKeys: [club.format.key],
        tier: 'local',
        club
      });
      edition += 1;
    }

    if (club.activity === 'occasional') continue;

    // The monthly Open: one Sunday-ish slot a month, two days off the club's weekly rhythm.
    const monthlySeries = pick(random, MONTHLY_SERIES);
    let monthlyEdition = 1;
    for (let month = -Math.floor(PAST_DAYS / 28); month <= Math.floor(FUTURE_DAYS.monthly / 28); month += 1) {
      const offset = slotOffset(club, month * 4) + 3;
      if (offset < -PAST_DAYS || offset > FUTURE_DAYS.monthly) continue;
      push({
        key: `stress-monthly-${club.key.slice(-3)}-${pad(monthlyEdition, 2)}`,
        organizationKey: club.key,
        organizerEmail: club.organizerEmails[club.organizerEmails.length - 1],
        title: `${monthlySeries} ${club.city} #${pad(monthlyEdition, 2)} — ${club.name}`,
        summary: summarize(`${club.format.name} — Open ${club.city}`),
        bodyHtml: eventBody(club.format, club, 'Open mensuel'),
        streetAddress: club.streetAddress,
        postalCode: club.postalCode,
        city: club.city,
        country: 'France',
        region: club.region,
        eventType: 'monthly',
        timeZoneId: 'Europe/Paris',
        startsAtLocalOffsetDays: offset,
        startsAtLocalTime: '10:00',
        endsAtLocalOffsetDays: offset,
        endsAtLocalTime: '20:00',
        capacity: TIERS.monthly.capacity,
        formatKeys: [club.format.key],
        tier: 'monthly',
        club
      });
      monthlyEdition += 1;
    }
  }

  // The Championnat Régional: every two months in each région, hosted by one of its clubs in turn.
  const byRegion = new Map();
  for (const club of clubs) {
    if (!byRegion.has(club.region)) byRegion.set(club.region, []);
    byRegion.get(club.region).push(club);
  }
  for (const [region, regionClubs] of byRegion) {
    let edition = 1;
    for (let stage = -Math.floor(PAST_DAYS / 56); stage <= Math.floor(FUTURE_DAYS.regional / 56); stage += 1) {
      const host = regionClubs[(edition - 1) % regionClubs.length];
      const offset = slotOffset(host, stage * 8) + 4;
      if (offset < -PAST_DAYS || offset > FUTURE_DAYS.regional) continue;
      push({
        key: `stress-regional-${slugify(region)}-${pad(edition, 2)}`,
        organizationKey: host.key,
        organizerEmail: host.organizerEmails[0],
        title: `Championnat Régional ${region} #${pad(edition, 2)}`,
        summary: summarize(`${host.format.name} — CR ${region}`),
        bodyHtml: eventBody(host.format, host, `Championnat Régional ${region}`),
        streetAddress: host.streetAddress,
        postalCode: host.postalCode,
        city: host.city,
        country: 'France',
        region,
        eventType: 'major',
        timeZoneId: 'Europe/Paris',
        startsAtLocalOffsetDays: offset,
        startsAtLocalTime: '09:00',
        endsAtLocalOffsetDays: offset,
        endsAtLocalTime: '21:00',
        capacity: TIERS.regional.capacity,
        formatKeys: [host.format.key],
        tier: 'regional',
        club: host,
        region
      });
      edition += 1;
    }
  }

  // The Championnat de France, once a year at Châteauroux, with the satellites that fill its weekend.
  const [nationalCity, nationalPostalCode, nationalRegion] = NATIONAL_CITY;
  const nationalHost = clubs.find((club) => club.city === nationalCity)
    ?? clubs.find((club) => club.region === nationalRegion)
    ?? clubs[0];
  const nationalFormat = formatsByKey.get(FORMATS[0].key) ?? nationalHost.format;
  // One a year: the edition that just passed, and the one already announced for next season.
  for (const [index, offset] of [FUTURE_DAYS.national - NATIONAL_YEAR_DAYS, FUTURE_DAYS.national].entries()) {
    const year = NATIONAL_YEARS[index];
    const at = (days, time, endTime, title, key, tier) => push({
      key,
      organizationKey: nationalHost.key,
      organizerEmail: nationalHost.organizerEmails[0],
      title,
      summary: summarize(`${nationalFormat.name} — CdF ${year} ${nationalCity}`),
      bodyHtml: `<p>Championnat de France ${year} en ${nationalFormat.name}, ${nationalCity}.</p>`
        + '<ul><li>Ronde 1 à 9h00</li><li>Decklists obligatoires</li><li>Top 8 le dimanche</li></ul>',
      streetAddress: `Parc des expositions, ${nationalCity}`,
      postalCode: nationalPostalCode,
      city: nationalCity,
      country: 'France',
      region: nationalRegion,
      eventType: 'major',
      timeZoneId: 'Europe/Paris',
      startsAtLocalOffsetDays: days,
      startsAtLocalTime: time,
      endsAtLocalOffsetDays: days,
      endsAtLocalTime: endTime,
      capacity: TIERS.national.capacity,
      formatKeys: [nationalFormat.key],
      tier,
      club: nationalHost,
      year
    });

    at(offset, '09:00', '23:00', `Championnat de France ${year} — Main Event`, `stress-national-${year}-main`, 'national');
    for (const [satellite, name] of NATIONAL_SATELLITES.entries()) {
      at(offset - 1 - satellite, '10:00', '20:00', `CdF ${year} — ${name}`, `stress-national-${year}-${slugify(name)}`, 'regional');
    }
  }

  return events;
}

/**
 * Registrations sit on Events that have not started yet — the API closes registration at start time, so
 * a fixture that put them in the past would describe a state the app cannot produce. Who registers
 * follows the same rule as who plays: an account has a home club and mostly registers there, a few
 * travel to the Open or the Championnat.
 */
function generateRegistrations(random, events, registrable, clubs) {
  const registrations = [];
  const seen = new Set();
  const homeClub = (index) => clubs[index % clubs.length];

  const add = (event, account) => {
    const key = `${event.key}/${account.email}`;
    if (seen.has(key)) return;
    seen.add(key);
    registrations.push({ tournamentKey: event.key, userEmail: account.email });
  };

  const byClub = new Map();
  for (const [index, account] of registrable.entries()) {
    const club = homeClub(index);
    if (!byClub.has(club.key)) byClub.set(club.key, []);
    byClub.get(club.key).push(account);
  }

  // Only the next two locals of a club take registrations: nobody signs up eight weeks out for a weekly.
  const upcomingLocals = new Map();
  for (const event of events) {
    if (event.startsAtLocalOffsetDays < 1) continue;
    if (event.tier === 'local') {
      const seenSoFar = upcomingLocals.get(event.club.key) ?? 0;
      if (seenSoFar >= 2) continue;
      upcomingLocals.set(event.club.key, seenSoFar + 1);
    }

    const locals = byClub.get(event.club.key) ?? [];
    const travellers = event.tier === 'local' ? 0 : event.tier === 'monthly' ? 4 : 12;
    const count = event.tier === 'local' ? between(random, 3, 9) : between(random, 6, 18);

    for (let index = 0; index < count && locals.length > 0; index += 1) add(event, locals[Math.floor(random() * locals.length)]);
    for (let index = 0; index < travellers; index += 1) add(event, registrable[Math.floor(random() * registrable.length)]);
  }
  return registrations;
}

/**
 * One Archive Tournament: a Swiss event played out round by round. Pairing is by current record — the
 * field is bucketed on wins and paired inside the buckets — so the standings the app computes read like
 * standings and not like a shuffle, and the odd field out gets its Bye.
 */
function playTournament(random, { id, seasonId, name, tournamentDate, status, roster, rounds, decks, recordMatchArchetypes }) {
  const records = new Map(roster.map((player) => [player, 0]));
  const playedRounds = [];

  for (let round = 0; round < rounds; round += 1) {
    const ordered = [...roster].sort((left, right) => {
      const byRecord = records.get(right) - records.get(left);
      return byRecord === 0 ? left.localeCompare(right) : byRecord;
    });
    // Shuffle inside each score bucket, so a bucket does not pair alphabetically week after week.
    const buckets = new Map();
    for (const player of ordered) {
      const wins = records.get(player);
      if (!buckets.has(wins)) buckets.set(wins, []);
      buckets.get(wins).push(player);
    }
    const paired = [];
    for (const wins of [...buckets.keys()].sort((left, right) => right - left)) {
      const bucket = buckets.get(wins);
      for (let position = bucket.length - 1; position > 0; position -= 1) {
        const swap = Math.floor(random() * (position + 1));
        [bucket[position], bucket[swap]] = [bucket[swap], bucket[position]];
      }
      paired.push(...bucket);
    }

    const entries = [];
    let table = 1;
    while (paired.length - (table - 1) * 2 >= 2) {
      const player1 = paired[(table - 1) * 2];
      const player2 = paired[(table - 1) * 2 + 1];
      const [player1Score, player2Score] = weighted(random, RESULTS);
      if (player1Score > player2Score) records.set(player1, records.get(player1) + 1);
      if (player2Score > player1Score) records.set(player2, records.get(player2) + 1);
      entries.push({
        kind: 'match',
        id: `${id}-r${round + 1}-m${table}`,
        table: String(table),
        player1Name: player1,
        player2Name: player2,
        player1Score,
        player2Score,
        // A hand-kept archive records the decks it saw; a thousand-player weekend records them once, on
        // the player list, and leaves the pairings bare.
        player1DeckArchetype: recordMatchArchetypes && random() < 0.5 ? decks.get(player1) ?? '' : '',
        player2DeckArchetype: recordMatchArchetypes && random() < 0.5 ? decks.get(player2) ?? '' : ''
      });
      table += 1;
    }
    if (paired.length % 2 === 1) {
      const bye = paired[paired.length - 1];
      records.set(bye, records.get(bye) + 1);
      entries.push({ kind: 'bye', id: `${id}-r${round + 1}-b${table}`, table: String(table), playerName: bye, deckArchetype: '' });
    }
    playedRounds.push({ id: `${id}-r${round + 1}`, entries });
  }

  return {
    id,
    name,
    seasonId,
    tournamentDate,
    status,
    rounds: playedRounds,
    playerArchetypes: roster.map((playerName) => ({ playerName, archetype: decks.get(playerName) ?? '' }))
  };
}

/** Wins per player, highest first — the record a Day 2 cut is really made on. */
function standings(tournament) {
  const wins = new Map();
  for (const round of tournament.rounds) {
    for (const entry of round.entries) {
      if (entry.kind === 'bye') wins.set(entry.playerName, (wins.get(entry.playerName) ?? 0) + 1);
      else if (entry.player1Score > entry.player2Score) wins.set(entry.player1Name, (wins.get(entry.player1Name) ?? 0) + 1);
      else if (entry.player2Score > entry.player1Score) wins.set(entry.player2Name, (wins.get(entry.player2Name) ?? 0) + 1);
    }
  }
  return tournament.playerArchetypes
    .map(({ playerName }) => playerName)
    .sort((left, right) => {
      const byWins = (wins.get(right) ?? 0) - (wins.get(left) ?? 0);
      return byWins === 0 ? left.localeCompare(right) : byWins;
    });
}

/** Candidates for a field: a club's own roster, or every roster in the région, or the whole country. */
function candidatePool(clubs) {
  const byName = new Map();
  for (const club of clubs) {
    for (const player of club.roster) {
      const existing = byName.get(player.name);
      if (existing === undefined || existing.weight < player.weight) byName.set(player.name, player);
    }
  }
  return [...byName.values()];
}

function decksFor(clubs, format, archetypesFor, random) {
  const decks = new Map();
  for (const club of clubs) {
    for (const [name, archetype] of club.decks) {
      // A player travelling to an event in another format brings a deck for that format instead.
      decks.set(name, club.format.key === format.key ? archetype : pick(random, archetypesFor(format)));
    }
  }
  return decks;
}

/** Day offset off the archive epoch for a UTC calendar date. Clock-free: `Date.UTC` reads nothing. */
const archiveDay = (year, month, day) => Math.round((Date.UTC(year, month - 1, day) - ARCHIVE_EPOCH) / 86400000);
/** The declared "today", as a day offset. Nothing generated here is ever dated past it. */
const ARCHIVE_ANCHOR_DAY = archiveDay(
  Number(ARCHIVE_ANCHOR_DATE.slice(0, 4)),
  Number(ARCHIVE_ANCHOR_DATE.slice(5, 7)),
  Number(ARCHIVE_ANCHOR_DATE.slice(8, 10))
);

/**
 * One Season's window, as day offsets off the epoch, clamped to the anchor.
 *
 * A `crossYear` Season runs August to August, the way a real autumn-to-spring season is labelled
 * `2025-26`; every other style stays inside one calendar year. The clamp is what keeps an archive
 * history: a Season whose window runs past the anchor simply stops there.
 */
function seasonWindow(startYear, crossYear) {
  const first = crossYear ? archiveDay(startYear, 8, 1) : archiveDay(startYear, 1, 8);
  const last = crossYear ? archiveDay(startYear + 1, 7, 31) : archiveDay(startYear, 12, 20);
  return [Math.min(first, ARCHIVE_ANCHOR_DAY), Math.min(last, ARCHIVE_ANCHOR_DAY)];
}

/**
 * The free string one Season labels itself with. A Season name is never parsed, sorted or derived
 * from: these styles exist so that assuming otherwise breaks a test rather than a page.
 */
function seasonLabel(style, leagueName, index, startYear) {
  switch (style) {
    case 'crossYear': return `${startYear}-${pad((startYear + 1) % 100, 2)}`;
    case 'numbered': return `Season ${index + 1}`;
    case 'numberedLeg': return `Season ${index + 1} - Round ${1 + (index % 3)}`;
    case 'yearSlash': return `${startYear}/${1 + (index % 2)}`;
    case 'ordinalLeg': return `${index + 1}ª Etapa Regular - ${startYear}/${1 + (index % 2)}`;
    case 'namedLeg': return `${leagueName} - Primeira Etapa`;
    default: return String(startYear);
  }
}

/**
 * The three-tier archive: `{ leagues, leagueSeasons, tournaments }`.
 *
 * A League is a series — a club's own league, a région's Championnat Régional, the Championnat de
 * France and the child series whose name embeds its parent's. Each carries `volumes.archiveSeasons`
 * Seasons, and a Season carries as many Tournaments as its drawn {@link SEASON_SIZE_CLASSES} says:
 * one for a Championship, sixty for a late Grand Prix season. Club Leagues draw that class, because a
 * store league really does vary; the régional and national ones are fixed to the class they are.
 *
 * Archive dates are absolute (ADR 0030), counted off the fixed epoch and clamped to
 * {@link ARCHIVE_ANCHOR_DATE}. Nothing here reads the clock, so `--seed=1` is the same bytes anywhere.
 */
function generateArchive(random, volumes, clubs, archetypesFor) {
  const leagueSeasons = [];
  const tournaments = [];
  const series = [];
  const takenSlugs = new Set();
  const slugFor = (value, index) => {
    const base = slugify(value);
    const slug = takenSlugs.has(base) ? `${base}-${pad(index, 3)}` : base;
    takenSlugs.add(slug);
    return slug;
  };

  // Only the clubs that run something more than a few times a year keep a League; the rest of the
  // circuit shows up on the Calendar and nowhere else, which is exactly how it looks in the wild.
  for (const club of clubs.filter((candidate) => candidate.activity !== 'occasional')) {
    const legs = [{ tier: 'local', candidates: club.roster, decks: club.decks, label: 'Manche' }];
    if (club.activity === 'monthly') {
      // The club's own monthly Open, drawing the région rather than the club: one leg in four.
      const regionClubs = clubs.filter((other) => other.region === club.region);
      legs.push({ tier: 'local', candidates: club.roster, decks: club.decks, label: 'Manche' });
      legs.push({ tier: 'local', candidates: club.roster, decks: club.decks, label: 'Manche' });
      legs.push({
        tier: 'monthly',
        candidates: candidatePool(regionClubs),
        decks: decksFor(regionClubs, club.format, archetypesFor, random),
        label: 'Open'
      });
    }
    series.push({ slug: slugFor(club.name, club.index), name: `${club.name} ${pick(random, ARCHIVE_SERIES_WORDS)}`, sizeClass: null, legs });
  }

  for (const region of [...new Set(clubs.map((club) => club.region))]) {
    const regionClubs = clubs.filter((club) => club.region === region);
    series.push({
      slug: slugFor(`cr-${region}`, 0),
      name: `Championnat Régional ${region}`,
      sizeClass: 'regional',
      legs: [{
        tier: 'regional',
        candidates: candidatePool(regionClubs),
        decks: decksFor(regionClubs, regionClubs[0].format, archetypesFor, random),
        label: 'Étape'
      }]
    });
  }

  // The Championnat de France weekend, the way it is really run and archived: Jour 1 is the full
  // Swiss, Jour 2 is the quarter of the field that survived it, and the satellites are their own thing.
  const nationwide = candidatePool(clubs);
  const nationalDecks = decksFor(clubs, FORMATS[0], archetypesFor, random);
  const national = { tier: 'national', candidates: nationwide, decks: nationalDecks };
  series.push({
    slug: slugFor('cdf', 0),
    name: 'Championnat de France',
    sizeClass: 'proTour',
    legs: [
      // Nine rounds of five hundred pairings would be over the megabyte the domain reads back; the real
      // weekend runs six on Jour 1 and three on the cut, which is also what fits.
      { ...national, label: 'Jour 1', numbered: false, rounds: NATIONAL_DAY_ONE_ROUNDS },
      { ...national, tier: 'cut', label: 'Jour 2', numbered: false, rounds: NATIONAL_DAY_TWO_ROUNDS },
      { tier: 'regional', candidates: nationwide, decks: nationalDecks, label: NATIONAL_SATELLITES[0], numbered: false },
      { tier: 'regional', candidates: nationwide, decks: nationalDecks, label: NATIONAL_SATELLITES[4], numbered: false }
    ]
  });
  // The one child series whose name embeds its parent's, so prefix-grouping heuristics visibly break.
  series.push({
    slug: slugFor('cdf-ptq', 0),
    name: `Championnat de France${EMBEDDED_CHILD_SUFFIX}`,
    sizeClass: 'regional',
    legs: [{ tier: 'monthly', candidates: nationwide, decks: nationalDecks, label: 'Qualifier' }]
  });

  const sizeClasses = new Map(SEASON_SIZE_CLASSES.map((entry) => [entry.key, entry]));
  const earliestDay = new Map();
  for (const entry of series) {
    const leagueId = `stress-archive-league-${entry.slug}`;
    for (let index = 0; index < volumes.archiveSeasons; index += 1) {
      // Oldest Season first, one calendar year apart, so the newest ends against the anchor.
      const startYear = Number(ARCHIVE_ANCHOR_DATE.slice(0, 4)) - (volumes.archiveSeasons - 1 - index);
      const sizeClass = entry.sizeClass === null
        ? weighted(random, SEASON_SIZE_CLASSES.map((item) => [item, item.weight]))
        : sizeClasses.get(entry.sizeClass);
      const style = weighted(random, SEASON_LABEL_STYLES.map((item) => [item, item.weight]));
      const count = between(random, sizeClass.minimum, sizeClass.maximum);
      const seasonId = `stress-archive-season-${entry.slug}-s${pad(index + 1, 2)}`;
      const [firstDay, lastDay] = seasonWindow(startYear, style.key === 'crossYear');
      const running = index === volumes.archiveSeasons - 1;
      leagueSeasons.push({
        id: seasonId,
        name: seasonLabel(style.key, entry.name, index, startYear),
        leagueId,
        status: running ? 'active' : 'completed',
        sizeClass: sizeClass.key
      });

      let previous = null;
      for (let leg = 0; leg < count; leg += 1) {
        const shape = entry.legs[leg % entry.legs.length];
        const roster = shape.tier === 'cut' && previous !== null
          ? standings(previous).slice(0, Math.max(8, Math.floor(previous.playerArchetypes.length / 4)))
          : drawField(random, shape.candidates, fieldSize(random, shape.tier === 'cut' ? 'regional' : shape.tier));
        const day = Math.min(firstDay + Math.round((leg * (lastDay - firstDay)) / Math.max(count - 1, 1)), ARCHIVE_ANCHOR_DAY);
        const played = playTournament(random, {
          id: `stress-archive-tournament-${entry.slug}-s${pad(index + 1, 2)}-${pad(leg + 1, 3)}`,
          seasonId,
          name: shape.numbered === false ? shape.label : `${shape.label} ${leg + 1}`,
          tournamentDate: archiveDate(day),
          // The last leg of the Season in progress is the one still being played. A Season of one would
          // then rank nobody, so it only happens once a completed leg sits behind it.
          status: running && count > 1 && leg === count - 1 ? 'active' : 'completed',
          roster,
          rounds: shape.rounds ?? roundsFor(roster.length),
          decks: shape.decks,
          // A thousand pairings carrying two archetypes each would push the document past what the
          // domain reads back; the player list keeps every deck, which is where the archive really
          // carries them.
          recordMatchArchetypes: roster.length <= 300
        });
        tournaments.push(played);
        previous = played;
        earliestDay.set(leagueId, Math.min(earliestDay.get(leagueId) ?? day, day));
      }
    }
  }

  // Standalone Tournaments: names carrying no series signal at all, plus a city. The public archive is
  // full of them, and a heuristic that grouped them into Leagues would invent series nobody ran.
  const cities = [...new Set(clubs.map((club) => club.city))];
  for (let index = 0; index < volumes.standaloneTournaments; index += 1) {
    const club = clubs[index % clubs.length];
    const roster = drawField(random, club.roster, fieldSize(random, 'local'));
    tournaments.push(playTournament(random, {
      id: `stress-archive-tournament-standalone-${pad(index, 3)}`,
      seasonId: null,
      name: index % 5 === 4 ? cities[index % cities.length] : DEGENERATE_TOURNAMENT_NAMES[index % DEGENERATE_TOURNAMENT_NAMES.length],
      tournamentDate: archiveDate(Math.round((index * ARCHIVE_ANCHOR_DAY) / Math.max(volumes.standaloneTournaments - 1, 1))),
      // A standalone Tournament names no Season and therefore no League, so it feeds the `global`
      // player-statistics scope only — and an `active` one would feed nothing at all.
      status: 'completed',
      roster,
      rounds: roundsFor(roster.length),
      decks: club.decks,
      recordMatchArchetypes: true
    }));
  }

  const leagues = [...new Set(leagueSeasons.map((season) => season.leagueId))].map((leagueId) => ({
    id: leagueId,
    name: series.find((entry) => `stress-archive-league-${entry.slug}` === leagueId).name,
    // Derived from the League's earliest Tournament, never from a clock.
    createdAt: `${archiveDate(earliestDay.get(leagueId) ?? 0)}T09:00:00Z`,
    // Public archives expose no series field; the League tier is this project's own construct.
    sourceSeriesId: null
  }));
  return { leagues, leagueSeasons, tournaments };
}

/**
 * Every generated Tournament has to stay under what the domain reads back, and the bulk loader writes
 * past the domain — so this is the only place the limit can be enforced. It throws rather than trims: a
 * silently shortened Championnat is a dataset that no longer describes what it claims to.
 */
export function assertTournamentBudget(tournaments) {
  for (const tournament of tournaments) {
    const bytes = Buffer.byteLength(JSON.stringify(tournament), 'utf8');
    if (bytes > TOURNAMENT_BYTE_BUDGET) {
      throw new Error(`Archive Tournament ${tournament.id} is ${bytes} bytes, over the ${TOURNAMENT_BYTE_BUDGET} byte budget the domain reads back.`);
    }
  }
  return tournaments;
}

/**
 * Running tournaments: the locals of the busiest clubs, caught at the point an organizer would be at.
 *
 * The `leagueKey` is minted here rather than looked up, because the League it names is a **legacy**
 * row: `POST /api/live-tournaments` still resolves its `leagueId` against `league_archive_aggregates`.
 */
function generateLiveTournaments(random, volumes, clubs, leagueSeasons) {
  const live = [];
  const hosts = clubs.filter((club) => club.activity !== 'occasional');
  for (let index = 0; index < volumes.liveTournaments; index += 1) {
    const club = hosts[index % hosts.length];
    const roundCount = 4;
    // Live pairing needs an even roster, and eight to twelve is what a local really seats.
    const players = drawField(random, club.roster, between(random, 4, 6) * 2);
    live.push({
      key: `stress-live-${pad(index, 2)}`,
      organizerEmail: club.organizerEmails[0],
      name: `${club.name} Live ${pad(index, 2)}`,
      // Every third one is unassigned, which finalizes to a standalone Archive Tournament.
      leagueKey: index % 3 === 0 ? null : leagueSeasons[index % leagueSeasons.length].id,
      tournamentDate: { offsetDays: 0 },
      roundCount,
      customRoundCount: true,
      paidTrackingEnabled: index % 2 === 0,
      scoredRounds: index % roundCount,
      leaveRoundOpen: index % 2 === 1,
      players: players.map((name) => ({
        name,
        initialWins: 0,
        initialDraws: 0,
        initialLosses: 0,
        archetype: club.decks.get(name) ?? ''
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
  const legacyArchetypes = readLegacyArchetypes(root);
  const archetypesFor = (format) => format.archetypes ?? legacyArchetypes;
  const pool = playerNamePool(volumes.playerPool);

  const clubs = generateClubs(random, volumes, FORMATS);
  assignRosters(random, clubs, pool, archetypesFor);

  const accounts = generateAccounts(random, volumes, clubs);
  const registrable = accounts.filter((account) => account.role === 'User' && account.emailConfirmed !== false);
  const organizations = generateOrganizations(clubs);
  const formats = generateFormats();
  const formatsByKey = new Map(formats.map((format) => [format.key, format]));

  const events = generateEvents(random, volumes, clubs, formatsByKey);
  const registrations = generateRegistrations(random, events, registrable, clubs);
  const archive = generateArchive(random, volumes, clubs, archetypesFor);
  assertTournamentBudget(archive.tournaments);
  const liveTournaments = generateLiveTournaments(random, volumes, clubs, archive.leagueSeasons);
  const auditRecords = generateAuditRecords(random, volumes, accounts);

  // `club`, `tier` and `year` are how this file reasons about an Event; the fixture format knows none
  // of them. Region is app-owned Event data and deliberately remains in the fixture. `events` keeps
  // internal labels — minus the club, which points back at a whole
  // roster — for the console summary and for the tests that gate the tier mix.
  const tournaments = events.map(({ club, tier, year, ...event }) => event);
  const labelled = events.map(({ club, ...event }) => event);

  return {
    accounts,
    organizations,
    formats,
    tournaments,
    registrations,
    archiveLeagues: archive.leagues,
    // `sizeClass` is how this file reasons about a Season; the fixture format knows no such field and
    // the restore endpoint would carry it straight to the API.
    archiveLeagueSeasons: archive.leagueSeasons.map(({ sizeClass, ...season }) => season),
    archiveTournaments: archive.tournaments,
    liveTournaments,
    auditRecords,
    events: labelled,
    // Kept out of `writeStressEnvironment`: it exists only so `countBySeasonSizeClass` has something to
    // count in the tests that gate the spread.
    leagueSeasonsBySizeClass: archive.leagueSeasons
  };
}

/**
 * One file per dataset key, in the shape `readEnvironment` expects. Returns the paths written.
 *
 * The archive is tens of megabytes, so it is written compactly: an indented League Archive is twice the
 * bytes for a file nothing reads by eye.
 */
export function writeStressEnvironment(data, directory = STRESS_DIRECTORY) {
  mkdirSync(directory, { recursive: true });
  const files = [
    ['accounts.json', data.accounts, true],
    ['organizations.json', data.organizations, true],
    ['formats.json', data.formats, true],
    ['tournaments.json', data.tournaments, false],
    ['registrations.json', data.registrations, false],
    ['archive-leagues.json', data.archiveLeagues, true],
    ['archive-league-seasons.json', data.archiveLeagueSeasons, true],
    ['archive-tournaments.json', data.archiveTournaments, false],
    ['live-tournaments.json', data.liveTournaments, true],
    [AUDIT_FILE, data.auditRecords, false]
  ];
  const written = [];
  for (const [file, rows, indented] of files) {
    const path = join(directory, file);
    writeFileSync(path, `${JSON.stringify(rows, null, indented ? 2 : 0)}\n`);
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

/** `{ local: n, monthly: n, ... }` for the console summary and for the tests that gate the tier mix. */
export function countByTier(events) {
  const counts = {};
  for (const event of events) counts[event.tier] = (counts[event.tier] ?? 0) + 1;
  return counts;
}

/** `{ championship: n, proTour: n, ... }` for the console summary and the tests that gate the spread. */
export function countBySeasonSizeClass(leagueSeasons) {
  const counts = {};
  for (const season of leagueSeasons) counts[season.sizeClass] = (counts[season.sizeClass] ?? 0) + 1;
  return counts;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const seed = parseSeed(process.argv.slice(2));
  if (!Number.isInteger(seed) || seed < 0) {
    console.error(`--seed must be a non-negative integer, got "${seed}".`);
    process.exit(2);
  }

  const data = generateStressEnvironment({ seed });
  const written = writeStressEnvironment(data);
  const tiers = countByTier(data.events);
  const entries = data.archiveTournaments.reduce((total, tournament) =>
    total + tournament.rounds.reduce((count, round) => count + round.entries.length, 0), 0);
  const standalone = data.archiveTournaments.filter((tournament) => tournament.seasonId === null).length;

  console.log(`Generated the "${STRESS_ENVIRONMENT}" environment from seed ${seed}:`);
  console.log([
    `  ${data.accounts.length} accounts`,
    `  ${data.organizations.length} clubs`,
    `  ${data.formats.length} formats`,
    `  ${data.tournaments.length} Events (${tiers.local ?? 0} locals, ${tiers.monthly ?? 0} monthly Opens, ${tiers.regional ?? 0} regional, ${tiers.national ?? 0} national)`,
    `  ${data.registrations.length} registrations`,
    `  ${data.archiveLeagues.length} archive Leagues, ${data.archiveLeagueSeasons.length} League Seasons, ${data.archiveTournaments.length} Tournaments (${standalone} standalone, ${entries} Round Entries)`,
    `  ${data.liveTournaments.length} running tournaments`,
    `  ${data.auditRecords.length} audit rows`
  ].join('\n'));
  console.log(`\nWrote ${written.length} files to ${STRESS_DIRECTORY}. Load it with: npm run dev -- --env=${STRESS_ENVIRONMENT}`);
}
