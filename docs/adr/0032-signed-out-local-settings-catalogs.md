# Signed-Out Local Settings Catalogs

## Status

Accepted. Sits beside ADR 0021 (role-scoped browser Live store) and ADR 0028 (dual-source League
Archive). Does not weaken ADR 0020 — no browser store becomes an authority for server data.

## Context

ADR 0020 retired the browser data authority and, with it, every browser-local Settings section: the
local deck archetype catalog, the local player rename and the migration-bundle export all went at
once. `settingsCapabilities()` was narrowed to four server-backed flags, and
`settings-capabilities.test.ts` gained an assertion that `localArchetypeMutation`,
`localPlayerRename` and `migrationBundleExport` are gone.

That narrowing over-corrected for two of the three.

An anonymous visitor is not a second-class visitor in this app. ADR 0021 gives them a whole running
tournament feature offline. ADR 0028 gives them the whole League Archive feature offline, with total
port parity — all 22 methods, not a subset. They can create a league, enter rounds, import results and
read standings without an account.

But the two Settings screens that make those features usable are gated behind roles they do not have:

- **Deck archetypes.** The archetype catalog names the decks a round entry references. The service
  that stores them locally, `DeckArchetypeSettingsService`, was never deleted — it still persists to
  `localStorage` under `gones.settings`, still merges the bundled `PRESET_LEGACY_ARCHETYPES`, and is
  still what the deck-archetype input reads. Only its Settings UI is gone. The component even still
  declares the signals for it (`newArchetype`, `filteredArchetypes`, `archetypeEdits`, …) and renders
  none of them.
- **Players.** A player exists because a round entry names them. An anonymous visitor who typos a name
  across three rounds of a browser-local league has no way to fix it in one place; the server player
  maintenance screen is Organizer-only and reads shared server leagues they cannot see anyway.

The third, the migration-bundle export, stays retired. ADR 0020's one-way door — nothing may produce a
new private migration bundle — is not reopened here and is not affected by this decision.

## Decision

**The browser-local Settings catalogs come back, offered as the complement of the server-backed ones.**

`SettingsCapabilities` gains two flags:

```ts
/** Browser-local deck archetype catalog — offered when no server catalog is. */
localCatalog: boolean;      // = !(flags.adminV1 && role === 'Admin')
/** Browser-local player rename over the browser League store — offered when no server maintenance is. */
localMaintenance: boolean;  // = !(role === 'Organizer' || role === 'Admin')
```

| viewer | `adminCatalog` | `localCatalog` | `organizerMaintenance` | `localMaintenance` |
| --- | --- | --- | --- | --- |
| anonymous | ✗ | ✓ | ✗ | ✓ |
| `User` | ✗ | ✓ | ✗ | ✓ |
| `Organizer` | ✗ | ✓ | ✓ | ✗ |
| `Admin` (adminV1) | ✓ | ✗ | ✓ | ✗ |

Complement, not union: a viewer never sees two archetype panels or two player panels, so there is
never a question about which one they just edited. An `Organizer` is the one asymmetric case — they
manage server players but have no server catalog, so they keep the local archetype list.

### Where the data lives

**Archetypes** reuse `DeckArchetypeSettingsService` unchanged: `localStorage`, keys `gones.settings`,
`gones.settings.language`, `gones.settings.deckArchetypes`, writes serialised through
`navigator.locks`. No new storage, no new key, and the file is already on the documented
`localStorage` allowlist in `server-authority-boundary.test.ts`.

**Players** are *derived*, never stored. `localPlayerNames(leagues)` folds every round entry of the
browser-local League store (`gones-leagues`, ADR 0028) into `{ name, occurrenceCount, leagueCount }`,
case-insensitively on `playerNameKey`. A rename walks the local leagues and calls
`LocalLeagueArchiveBackend.renameLeagueArchivePlayerName` per league, carrying each returned
`documentVersion` forward. There is no local player table to drift out of sync with the leagues.

### Browser-wide, deliberately

Neither store is namespaced by user. `gones-leagues`, `gones-live` and `gones.settings` are
origin-scoped, so anyone opening the site in that browser sees the same local data — which is exactly
what was asked for, and the same property ADR 0021 and ADR 0028 already rely on.
`browser-local-scope.test.ts` asserts it: those sources reference no profile, no user id and do not
import `AuthService`. The one browser store that *is* user-scoped, the read cache of ADR 0031, is
asserted from the other direction so the distinction stays deliberate.

### Conflict with the server

The archetype catalog is the one place where a local list and a server list describe the same thing.
The rule is ADR 0031's: **remote prevails and erases local.** On sign-in, and on a successful bootstrap
with a live session, `DeckArchetypeSettingsService.adoptServerCatalog(names)` replaces the browser list
with `GET /api/deck-archetypes`. It is a replace, not a merge, and nothing local is ever uploaded.
A failed fetch changes nothing, so signing in offline is safe.

Local players have no such conflict: they are a projection of browser-local leagues, which the server
never sees.

## Consequences

- An anonymous visitor can label decks and fix player names for the leagues they run in this browser,
  which is what makes the offline League Archive of ADR 0028 actually usable.
- No new browser storage, no new IndexedDB store, no new network call on the local paths — DevTools
  Network stays empty while either local section is used.
- Custom archetypes added while signed out are lost the first time that browser signs in. That is the
  stated conflict rule, and it is why the section says so in its help text.
- `settings-capabilities.test.ts` loses two names from its retired list. `migrationBundleExport` stays
  on it; ADR 0020's one-way door is untouched.
- The Settings page grows two sections, both behind flags, and none of the existing server-backed
  sections change behaviour.
