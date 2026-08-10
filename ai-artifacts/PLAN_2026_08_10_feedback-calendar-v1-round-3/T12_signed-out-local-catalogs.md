# T12: Signed-out local catalogs

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** A visitor who is not signed in (or signed in as a plain `User`) can manage deck archetypes and rename players from `/settings`. Both are stored in this browser only, exactly like browser-local archived leagues and running tournaments.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice is feedback #12 — "When the user is not connected, he should still have access to archetypes and players in the settings; however, it should be saved only locally, exactly like archived leagues and running tournaments."
- This slice: two new Settings sections, gated on *not* having the server-backed equivalent, reading and writing only browser storage.
- Out of scope here: what happens when that visitor later signs in — that is T14 ("remote always prevails"). The Admin server catalog section. The Organizer server player section. Any network call.
- Assumptions in force:
  - Archetypes reuse the **existing** `DeckArchetypeSettingsService` (`src/app/shared/deck-archetype-settings.service.ts`), which already persists to `localStorage` under `gones.settings` and is browser-wide, not user-scoped.
  - Players are derived from the browser-local League store (`gones-leagues` / `leagues`, ADR 0028) and renamed through `LocalLeagueArchiveBackend`. There is no local player table — a player exists because a round entry names them.
  - Read `docs/adr/0032-signed-out-local-settings-catalogs.md` before coding.
  - No TestBed — component tests assert on template source; logic tests call pure functions and fakes directly.

## Inputs

- `src/app/features/settings/settings-capabilities.ts`:
  ```ts
  export interface SettingsCapabilities { adminCatalog: boolean; organizerMaintenance: boolean; profileLink: boolean; orgNotifications: boolean; }
  export function settingsCapabilities(flags: { authV1: boolean; adminV1: boolean }, role: GlobalRole | null | undefined): SettingsCapabilities
  ```
  Current body: `adminCatalog: flags.adminV1 && role === 'Admin'`, `organizerMaintenance: role === 'Organizer' || role === 'Admin'`, `profileLink: signedIn`, `orgNotifications: signedIn && flags.adminV1`, where `signedIn = flags.authV1 && role != null`.
- `src/app/features/settings/settings-capabilities.test.ts` — **contains a test that this ticket must change**: `it('offers no browser-authority section at all')` asserts `localArchetypeMutation`, `localPlayerRename` and `migrationBundleExport` are all `undefined`, and `it('exposes nothing to an anonymous viewer …')` asserts the object equals exactly the four current keys. Both need updating; `migrationBundleExport` stays retired (ADR 0020's one-way door is untouched by this ticket).
- `src/app/features/settings/settings.component.ts`:
  - Already injects `DeckArchetypeSettingsService` as `deckArchetypes`, `LeagueArchiveRepository` as `leagueRepo`, `LiveTournamentRepository` as `liveRepo`, `AuthService` as `auth`, `Client` as `client`, `MatDialog` as `dialog`.
  - Already **declares but never renders** the local-archetype state: `newArchetype`, `archetypeFilter`, `archetypeMessage`, `archetypeSaving`, `editingArchetype`, `archetypeEdits`, `archetypes = this.deckArchetypes.archetypes`, `filteredArchetypes` (filters `archetypes()` by `archetypeKey(this.archetypeFilter())`). Reuse them — do not add parallel signals.
  - Already renders the Admin server catalog under `@if (capabilities().adminCatalog)` with `data-cy="settings-archetype-card"`, and the Organizer server players under `@if (capabilities().organizerMaintenance)` with `data-cy="settings-players-card"`. Both use `mat-expansion-panel` + `.settings-archetype-item` rows; copy that markup shape.
  - Already imports `archetypeKey`, `normalizeArchetypeName`, `playerNameKey`, `trimPlayerName`, `ConfirmDialogComponent`, `logBoundaryError`.
- `src/app/shared/deck-archetype-settings.service.ts` — public methods: `archetypes` (computed `string[]`), `has(name)`, `add(name): Promise<boolean>`, `update(previousName, nextName): Promise<boolean>`, `remove(name): Promise<void>`, `suggestions(query, limit?)`, `exportSettings()`, `replaceSettings(value)`, `mergeArchetypes(value)`, `bootstrapFromStorage()`. Storage key `gones.settings`; the bundled `PRESET_LEGACY_ARCHETYPES` are always merged back in on load.
- `src/app/backend/local-league-archive-backend.service.ts` — `LocalLeagueArchiveBackend`, `LOCAL_LEAGUE_DB_NAME = 'gones-leagues'`, `LOCAL_LEAGUE_STORE = 'leagues'`. Implements the whole `LeagueArchiveBackendPort`, including `listLeagueArchives(): Promise<PersistedLeague[]>` and `renameLeagueArchivePlayerName(id, expectedVersion, fromName, toName): Promise<PersistedLeague>`.
- `src/app/data/league-archive-origin.ts` — `isLocalLeagueId(id)`, `isAnyPlaceholderLeagueId(id)`.
- `src/app/domain/rename-player.ts` — `playerNameKey(name)`, `samePlayerName(left, right)`.
- `src/app/domain/models.ts` — `PersistedLeague` = `{ id, name, status, tournaments, documentVersion, … }`; `TournamentDocument.rounds[].entries[]` is `{ kind: 'match', player1Name, player2Name, … } | { kind: 'bye', playerName, … }`.
- `src/app/api/generated/gones-api.ts` — `PlayerNameSummary` = `{ name, occurrenceCount, leagueCount }`. Reuse that shape for local players so the two panels render identically.
- **From Depends:** none.

## Requirements

### Capability flags

`SettingsCapabilities` gains two fields, and `settingsCapabilities` computes them as the complement of the server-backed sections:

```ts
/** Browser-local deck archetype catalog — offered when no server catalog is (ADR 0032). */
localCatalog: boolean;      // = !(flags.adminV1 && role === 'Admin')
/** Browser-local player rename over the browser League store — offered when no server maintenance is. */
localMaintenance: boolean;  // = !(role === 'Organizer' || role === 'Admin')
```

So: anonymous → both `true`. `User` → both `true`. `Organizer` → `localCatalog` `true`, `localMaintenance` `false`. `Admin` on an `adminV1` build → both `false`.

### Local archetype section

New card, rendered under `@if (capabilities().localCatalog)`, placed immediately **after** the `@if (capabilities().adminCatalog)` card:

- `mat-card` `data-cy="settings-local-archetype-card"`, `mat-expansion-panel` `data-cy="settings-local-archetype-panel"`, title `i18n.t('settings.deckArchetypes')`, description `{{ filteredArchetypes().length }} / {{ archetypes().length }}`.
- Help paragraph `data-cy="settings-local-archetype-copy"` reading a new key `settings.localCatalogHelp`.
- Add form `data-cy="settings-add-local-archetype-form"` → `(ngSubmit)="addLocalArchetype()"`, input `data-cy="settings-new-local-archetype-input"` bound to `newArchetype`, submit `data-cy="settings-add-local-archetype-button"` disabled when `!normalizeArchetypeName(newArchetype())` or `archetypeSaving()`.
- Filter field `data-cy="settings-local-archetype-filter"` bound to `archetypeFilter`.
- Row list `data-cy="settings-local-archetype-list"`, one `data-cy="settings-local-archetype-row"` per `filteredArchetypes()`, each with an update button `data-cy="settings-update-local-archetype-button"` that flips `editingArchetype`, a save button `data-cy="settings-save-local-archetype-button"` calling `saveLocalArchetypeEdit(name)`, and a delete button `data-cy="settings-remove-local-archetype-button"` calling `removeLocalArchetype(name)`.
- Empty state `data-cy="settings-empty-local-archetypes"` reusing `settings.emptyArchetypes`.
- Status line `data-cy="settings-local-archetype-message"` bound to `archetypeMessage()`.

New component methods, all `async`, all setting `archetypeMessage` from existing keys:

```ts
async addLocalArchetype(): Promise<void>            // deckArchetypes.add(newArchetype()); clears newArchetype on success
async saveLocalArchetypeEdit(name: string): Promise<void> // deckArchetypes.update(name, archetypeEdits()[name] ?? '')
async removeLocalArchetype(name: string): Promise<void>   // ConfirmDialogComponent, then deckArchetypes.remove(name)
startLocalEdit(name: string): void
localEditValue(name: string): string
setLocalEditValue(name: string, value: string): void
```

### Local player section

New card, rendered under `@if (capabilities().localMaintenance)`, placed immediately **after** the `@if (capabilities().organizerMaintenance)` card:

- Same shape as the server player panel: `data-cy="settings-local-players-card"`, panel `data-cy="settings-local-players-panel"`, title `i18n.t('settings.players')`, description `{{ filteredLocalPlayers().length }} / {{ localPlayers().length }}`.
- Help paragraph `data-cy="settings-local-players-copy"` reading a new key `settings.localMaintenanceHelp`.
- Filter `data-cy="settings-local-player-filter"` reusing `playerFilter`.
- Rows `data-cy="settings-local-player-row"` with `data-cy="settings-local-player-name"`, usage span `data-cy="settings-local-player-usage"` reusing `settings.playerUsage`, update / save buttons `data-cy="settings-update-local-player-button"` / `data-cy="settings-save-local-player-button"`.
- Empty states `data-cy="settings-empty-local-player-filter"` and `data-cy="settings-empty-local-players"` reusing `settings.noPlayerFilterMatches` / `settings.emptyPlayers`.
- Status `data-cy="settings-local-player-message"` bound to `playerMessage()`.

New **pure** helper, in a new file `src/app/features/settings/local-player-names.ts`:

```ts
import { PersistedLeague } from '../../domain/models';

export interface LocalPlayerSummary { name: string; occurrenceCount: number; leagueCount: number; }

/**
 * Every player named by a round entry of the given leagues, folded case-insensitively on
 * `playerNameKey` and sorted by name. `occurrenceCount` counts round-entry appearances;
 * `leagueCount` counts distinct leagues.
 */
export function localPlayerNames(leagues: PersistedLeague[]): LocalPlayerSummary[]
```

Rules: a `kind: 'match'` entry contributes `player1Name` and `player2Name`; a `kind: 'bye'` entry contributes `playerName`; blank names after `trimPlayerName` are skipped; the display `name` is the first spelling seen in sorted-league order.

New component state and methods:

```ts
readonly localPlayers = signal<LocalPlayerSummary[]>([]);
readonly filteredLocalPlayers = computed(() => { const filter = playerNameKey(this.playerFilter()); const list = this.localPlayers(); return filter ? list.filter(p => playerNameKey(p.name).includes(filter)) : list; });
async loadLocalPlayers(): Promise<void>            // localBackend.listLeagueArchives() -> localPlayerNames()
async saveLocalPlayerEdit(player: LocalPlayerSummary): Promise<void> // rename in every local league that names them, then reload
```

`saveLocalPlayerEdit` iterates the local leagues, and for each league whose documents name the player,
calls `localBackend.renameLeagueArchivePlayerName(league.id, league.documentVersion, player.name, nextName)`
sequentially, taking the returned document's `documentVersion` for the next call. Inject the store as
`private readonly localBackend = inject(LocalLeagueArchiveBackend);`.

Load `loadLocalPlayers()` from the same `effect` that already lazily loads `serverPlayers` — mirror the
`serverPlayersLoaded` one-shot guard with a `localPlayersLoaded` flag, driven by `capabilities().localMaintenance`.

### i18n

Add to **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`:

| key | en | fr |
| --- | --- | --- |
| `settings.localCatalogHelp` | `Deck archetypes stored in this browser only. They are never sent to the server.` | `Archétypes de deck stockés uniquement dans ce navigateur. Ils ne sont jamais envoyés au serveur.` |
| `settings.localMaintenanceHelp` | `Player names found in the leagues stored in this browser. Renames apply to those leagues only.` | `Noms de joueurs trouvés dans les ligues stockées dans ce navigateur. Le renommage ne s'applique qu'à ces ligues.` |

## TDD

1. **Red** — write `src/app/features/settings/local-player-names.test.ts`, update `settings-capabilities.test.ts`, and add the template tests to `src/app/features/settings/settings-capabilities.test.ts`'s sibling component test. All fail.
2. **Green** — capability flags, then `localPlayerNames`, then the component members, then the two template cards, then the i18n keys.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `local sections are the complement of the server sections` (`settings-capabilities.test.ts`) | `settingsCapabilities({authV1:true,adminV1:true}, role)` for `null`, `'User'`, `'Organizer'`, `'Admin'` | `localCatalog` → `true, true, true, false`; `localMaintenance` → `true, true, false, false` |
| `an anonymous viewer on a bare build still gets both local sections` (same file) | `settingsCapabilities({authV1:false,adminV1:false}, null)` | equals `{ adminCatalog: false, organizerMaintenance: false, profileLink: false, orgNotifications: false, localCatalog: true, localMaintenance: true }` |
| `the retired browser sections stay retired` (same file, edited) | every role | `migrationBundleExport` is still `undefined`; the assertion list no longer names `localArchetypeMutation` or `localPlayerRename` |
| `localPlayerNames folds match and bye entries` (`local-player-names.test.ts`) | one league, one tournament, one round with a match `A` vs `B` and a bye for `A` | `[{ name: 'A', occurrenceCount: 2, leagueCount: 1 }, { name: 'B', occurrenceCount: 1, leagueCount: 1 }]` |
| `localPlayerNames folds case and counts leagues` (same file) | league 1 names `Alice`, league 2 names `alice` | one row, `occurrenceCount: 2`, `leagueCount: 2`, `name: 'Alice'` |
| `localPlayerNames skips blank names` (same file) | a match entry with `player2Name: '   '` | the result has no entry whose trimmed name is empty |
| `the settings page renders both local sections behind their flags` (`settings.component.test.ts`, new file if absent) | source of `settings.component.ts` | contains `@if (capabilities().localCatalog) {` wrapping `data-cy="settings-local-archetype-card"`, and `@if (capabilities().localMaintenance) {` wrapping `data-cy="settings-local-players-card"` |
| `the local sections never call the API client` (same file) | the two template block slices and the bodies of `addLocalArchetype`, `saveLocalArchetypeEdit`, `removeLocalArchetype`, `loadLocalPlayers`, `saveLocalPlayerEdit` | none of them contains `this.client.` |

Use the brace-counting `templateBlock(opening)` helper from
`src/app/features/leagues-archive/league-archive-list.component.test.ts` for the block slices.

Run: `npx vitest run src/app/features/settings`

## Impl steps

- [x] 1. Read `docs/adr/0032-signed-out-local-settings-catalogs.md`. — done when: the flag formulas below are confirmed against the ADR's viewer table.
- [x] 2. Update `src/app/features/settings/settings-capabilities.test.ts`: add the two new tests, and edit the retired-section test so it only names `migrationBundleExport`, and the anonymous-equality test so it expects the six keys. — done when: the file contains the two new `it(...)` blocks and no longer names `localArchetypeMutation` / `localPlayerRename`.
- [x] 3. Create `src/app/features/settings/local-player-names.test.ts` with the three `localPlayerNames` tests. — done when: the file exists with three `it(...)` blocks.
- [x] 4. Run `npx vitest run src/app/features/settings` — confirm red. (`Test Files 3 failed | 4 passed`, `Tests 4 failed | 28 passed`) — done when: the run fails naming the new tests.
- [x] 5. Add `localCatalog` and `localMaintenance` to `SettingsCapabilities` and to `settingsCapabilities` in `src/app/features/settings/settings-capabilities.ts`, with the doc comments above. — done when: `npx vitest run src/app/features/settings/settings-capabilities.test.ts` is green.
- [x] 6. Create `src/app/features/settings/local-player-names.ts` with `LocalPlayerSummary` and `localPlayerNames`. — done when: `npx vitest run src/app/features/settings/local-player-names.test.ts` is green.
- [x] 7. Re-run `npx vitest run src/app/features/settings` — the capability and pure-function tests go green. (`Test Files 2 passed`, `Tests 9 passed` for the two files; component-template tests still red by design)
- [x] 8. Add the two i18n keys to both maps in `src/app/i18n/messages.ts`. — done when: both keys appear once in the `en` map and once in the `fr` map.
- [x] 9. In `src/app/features/settings/settings.component.ts`, inject `LocalLeagueArchiveBackend`, add `localPlayers`, `filteredLocalPlayers`, `localPlayersLoaded`, `loadLocalPlayers`, `saveLocalPlayerEdit`, and the six local-archetype methods. — done when: `npm run typecheck` is green and every named member exists in the file.
- [x] 10. Add the `@if (capabilities().localCatalog)` archetype card after the `adminCatalog` card, using the existing `newArchetype` / `archetypeFilter` / `filteredArchetypes` / `editingArchetype` / `archetypeEdits` / `archetypeMessage` / `archetypeSaving` signals. — done when: the ticket's `settings-local-archetype-*` `data-cy` values are all present inside that guard and `npx vitest run src/app/shared/data-cy-coverage.test.ts` is green.
- [x] 11. Add the `@if (capabilities().localMaintenance)` players card after the `organizerMaintenance` card. — done when: the ticket's `settings-local-player*` `data-cy` values are all present inside that guard and `npx vitest run src/app/shared/data-cy-coverage.test.ts` is green.
- [x] 12. Extend the existing lazy-load `effect` to call `loadLocalPlayers()` once when `capabilities().localMaintenance` is true. — done when: the `effect` body guards on `localPlayersLoaded` and `npm run typecheck` is green.
- [x] 13. Add the two component-template tests. Run `npx vitest run src/app/features/settings` — green. (`Test Files 9 passed`, `Tests 55 passed` with `data-cy-coverage` + `server-authority-boundary`)
- [x] 14. Run `npm run test && npm run lint && npm run typecheck && npm run build`. (test `99 files / 827 tests passed`; lint `All files pass linting`; typecheck silent; build `Application bundle generation complete`) `src/app/backend/server-authority-boundary.test.ts` must stay green — no new file may touch `indexedDB` directly.
- [ ] 15. (moved to `ai-artifacts/manual_test_checklist.md` → `## T12 signed-out-local-catalogs`; reload persistence, the rename landing in the store and the empty Network log are proved headlessly, the second tab and the League detail render are not) Manual, signed out: `/settings` shows Deck archetypes and Players. Add an archetype, reload the page — it is still there. Create a local league with a round from `/leagues-archive`, come back to `/settings` — the players appear; rename one and check the league detail page shows the new name. Open the site in a second tab — the same archetypes and players are there.
- [x] 16. Manual, signed in as `admin@gones.test`: the Admin server catalog is shown and the local archetype card is **not**. (proved headlessly with a throwaway Cypress spec, stubbed `Admin` profile: `settings-archetype-card` + `settings-players-card` exist, `settings-local-archetype-card` + `settings-local-players-card` do not — `2 passing`; spec deleted after the run)

## Outputs

- Files added: `src/app/features/settings/local-player-names.ts`, `src/app/features/settings/local-player-names.test.ts`, `src/app/features/settings/settings.component.test.ts` (if it does not exist).
- Files edited: `src/app/features/settings/settings-capabilities.ts`, `src/app/features/settings/settings-capabilities.test.ts`, `src/app/features/settings/settings.component.ts`, `src/app/i18n/messages.ts`.
- Public API change: `SettingsCapabilities` gains `localCatalog` and `localMaintenance`; new pure `localPlayerNames(leagues)`.
- Behaviour change: two new Settings sections for anonymous and plain-`User` visitors, browser-storage only.
- Migration/config: none. No new dependency, no new IndexedDB store.

## Validation

- [x] `npx vitest run src/app/features/settings` passes. (`Test Files 9 passed | Tests 55 passed` with the two guardrail files)
- [x] `npm run test` passes, including `src/app/backend/server-authority-boundary.test.ts` and `src/app/shared/data-cy-coverage.test.ts`. (`Test Files 99 passed (99)`, `Tests 827 passed (827)`)
- [x] `npm run lint` passes. (`All files pass linting`)
- [x] `npm run typecheck` passes. (no output, exit 0)
- [x] `npm run build` passes. (`Application bundle generation complete`)
- [x] `npm run cy:run -- --spec cypress/e2e/settings-server.cy.js` passes. (run through the NixOS `steam-run` wrapper: `4 passing`, all four capability specs green)
- [ ] Manual: signed out, archetypes persist across reload and across tabs; a local-league player rename lands in the league detail page. (reload persistence + the rename landing in the `gones-leagues` row proved headlessly; **second tab** and the **league detail page** render stay for the human — see `ai-artifacts/manual_test_checklist.md`)
- [x] Manual: signed in as Admin, the local archetype card is hidden and the server catalog is shown. (throwaway Cypress spec, see Impl step 16)
- [x] Manual: DevTools → Network is empty while using either local section. (same spec intercepted every `/api/` call; after adding an archetype and renaming a local player the recorded list minus `auth/refresh` was `[]`)
- [x] App functional — no broken path from this slice. (`npm run test` 827 passed, `settings-server.cy.js` 4 passing, build green)
- [ ] Commit msg draft: `feat(settings): give signed-out visitors local archetype and player catalogs`
