/**
 * Bundled Legacy archetype baseline.
 * Source snapshot: mtgtop8 All 2025 Legacy + MTGGoldfish Legacy metagame.
 * Keep in sync with src/assets/config/legacy-archetype-presets.json
 *
 * Name format: `{Archetype} ({color identity})`
 * - 1 color: White / Blue / Black / Red / Green / Colorless
 * - 2 colors: Ravnica guild name
 * - 3 colors: Alara shard or Tarkir wedge name
 * - 4 colors: 4c
 * - 5 colors: 5c
 */
export const LEGACY_ARCHETYPE_PRESETS_CONFIG = {
  format: 'Legacy',
  window: 'last-year',
  source: 'mtgtop8 All 2025 Legacy (~15k decks) + MTGGoldfish Legacy metagame',
  sourceUrls: [
    'https://mtgtop8.com/format?f=LE&meta=316',
    'https://www.mtggoldfish.com/metagame/legacy/full'
  ],
  generatedAt: '2026-07-14',
  count: 49,
  archetypes: [
    'Reanimator (Rakdos)',
    'Tempo (Dimir)',
    'Delver (Izzet)',
    'Show and Tell (Blue)',
    'Sneak and Show (Izzet)',
    'Cephalid Breakfast (Simic)',
    'Dragon Stompy (Red)',
    'Eldrazi (Colorless)',
    'Mystic Forge (Colorless)',
    'Death and Taxes (White)',
    'Control (UWx)',
    'Lands (Gruul)',
    'Cloudpost (Blue)',
    'Oops All Spells (Jund)',
    'Nadu (Simic)',
    'Painter (Red)',
    'Doomsday (Dimir)',
    'Canadian Threshold (Temur)',
    'Artifacts (Blue)',
    'The EPIC Storm (Grixis)',
    'Initiative Stompy (White)',
    'Energy (Mardu)',
    'Energy (Boros)',
    'Maverick (Selesnya)',
    'Ninjas (Dimir)',
    'Control (Grixis)',
    'Control (Sultai)',
    'Control (Bant)',
    'Stoneblade (Azorius)',
    'Cradle Control (Green)',
    'Stiflenought (Blue)',
    'Dark Depths (Golgari)',
    'Goblins (Red)',
    'Merfolk (Blue)',
    'Dredge (Black)',
    'Elves (Green)',
    'Aluren (Sultai)',
    'Infect (Simic)',
    'Storm (Red)',
    'Turbo Depths (Golgari)',
    'Affinity (Blue)',
    'Burn (Red)',
    'Humans (White)',
    'Pox (Black)',
    'Nic Fit (Golgari)',
    'Reanimator (Black)',
    'Omni-Tell (Blue)',
    'Control (Jeskai)',
    'Beanstalk Control (Bant)'
  ]
} as const;

/** Ordered preset list used when seeding settings / autocomplete. */
export const PRESET_LEGACY_ARCHETYPES: readonly string[] = LEGACY_ARCHETYPE_PRESETS_CONFIG.archetypes;
