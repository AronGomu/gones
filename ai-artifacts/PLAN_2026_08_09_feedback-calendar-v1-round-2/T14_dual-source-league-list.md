# T14: Dual-source league list and write routing

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T13
**Commit outcome:** A signed-out visitor can create and fully manage leagues stored in this browser; a signed-in Organizer or Admin sees the server's leagues and their own local ones in one list, with local rows badged, and every write goes to the store that owns the league.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material).
- This slice: the third quarter of feedback line 4 — "When I am not connected and go to the leagues page, the archive league page, I don't see any option to create a new league or manage my archived league. Make sure it works exactly like the live tournament feature. When I don't have an account or am not an admin or organizer, I am allowed to use the feature, but none of the data will be synchronized or saved in the backend. Everything is saved locally in the local DB. And one general rule is that the database is always the source of truth, so if there are any differences between the data in the database and the data in the application, the data in the database always prevails."
- Out of scope here: export and import (T15), the Live Tournament feature, any backend change.
- Assumptions in force: **A3** the two stores are **merged**, not exclusive — this is where Gones diverges from ADR 0021's one-adapter-by-role model; **A4** origin is encoded in the id; **A5** "the database always prevails" means every command's return value replaces the component's in-memory state, and a failed command triggers a reload from the store rather than keeping an optimistic edit.

### Read this first

`docs/adr/0028-dual-source-league-archive.md`. It is the specification.

### What T12 and T13 left you — quote it, do not re-derive it

`src/app/data/league-archive-origin.ts`:

```ts
export const LOCAL_LEAGUE_ID_PREFIX = 'local-';
export const LOCAL_PLACEHOLDER_LEAGUE_ID = 'local-placeholder-league';
export function isLocalLeagueId(id: string | null | undefined): boolean;
export function newLocalLeagueId(uuid?: string): string;
export function isAnyPlaceholderLeagueId(id: string | null | undefined): boolean;
```

`src/app/backend/local-league-archive-backend.service.ts`:

```ts
export const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';
export const LOCAL_LEAGUE_STORE = 'leagues';
export class LeagueConcurrencyError extends Error { readonly status = 412; /* message 'staleLeagueDocument' */ }

@Injectable({ providedIn: 'root' })
export class LocalLeagueArchiveBackend implements LeagueArchiveBackendPort { /* all 22 methods */ }
```

Its stale rejections carry `status === 412`, which `leagueCommandError` in `src/app/data/league-archive-command-ux.ts` already maps to `'stale'`. A cross-store move rejects with `Error('crossAuthorityMoveNotSupported')`.

### Current state — read before editing

`src/app/data/league-archive-repository.service.ts` (111 lines) is a thin facade over exactly one port:

```ts
@Injectable({ providedIn: 'root' })
export class LeagueArchiveRepository {
  private readonly backend: LeagueArchiveBackendPort = inject(LEAGUE_ARCHIVE_BACKEND);

  async listLeagues(): Promise<PersistedLeague[]> { return this.backend.listLeagueArchives(); }
  async getLeague(id: string): Promise<PersistedLeague | null> { return this.backend.getLeagueArchive(id); }
  async createLeague(name: string, idempotencyKey?: string): Promise<PersistedLeague> {
    if (isUnassignedLeagueName(name)) return this.ensurePlaceholderLeague();
    return this.backend.createLeagueArchive(name, idempotencyKey);
  }
  // …19 more, every one delegating to this.backend, most passing league.documentVersion as the expected version
  async ensurePlaceholderLeague(): Promise<PersistedLeague> {
    const existing = await this.backend.getLeagueArchive(PLACEHOLDER_LEAGUE_ID);
    if (!existing) throw new Error('placeholderLeagueMissing');
    return existing;
  }
}
```

`LEAGUE_ARCHIVE_BACKEND` (`src/app/backend/application-backend.ts` line 126) is bound unconditionally to `AspNetApiBackend`. **Leave that token exactly as it is** — the server adapter stays the server adapter. The merge happens in the repository, which will inject the local backend as a second dependency.

Role gate, `src/app/data/league-archive-command-ux.ts`:

```ts
export function canManageLeagues(role: GlobalRole | null | undefined): boolean {
  return role === 'Organizer' || role === 'Admin';
}
```

Four components read it and gate their write UI on it:

| File | Line | Member |
| --- | --- | --- |
| `src/app/features/leagues-archive/league-archive-list.component.ts` | 66 | `readonly canManage = computed(() => canManageLeagues(this.auth.profile()?.globalRole));` |
| `src/app/features/leagues-archive/league-archive-detail.component.ts` | 81 | same |
| `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` | 193 | same |
| `src/app/app.component.ts` | 132 | `readonly canManageLeagueData = computed(() => canManageLeagues(this.auth.profile()?.globalRole));` |

All four must become per-league: a local league is always manageable; a server league needs the role.

The Live feature's precedent for the list UI, `src/app/features/live-tournaments/live-tournament-list.component.ts` lines 30 and 86–88:

```html
@if (localMode) { <p class="muted" role="status" data-cy="live-local-mode-notice">{{ i18n.t('live.localModeNotice') }}</p> }
```
```ts
readonly localMode = inject(LIVE_BACKEND_MODE) === 'browser-local';
readonly canManage = computed(() => this.localMode || canManageLive(this.auth.profile()?.globalRole));
```

The league list's own create affordance, `league-archive-list.component.ts` lines 48–53:

```html
@if (canManage()) {
  <button class="league-card league-create-card" type="button" [disabled]="creating()" (click)="createLeague()" data-cy="leagues-archive-list-create-card">…</button>
} @else { <p class="muted" data-cy="leagues-archive-list-read-only">{{ i18n.t('leagues.readOnly') }}</p> }
```

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`); every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`; a new Cypress spec must be wired into `scripts/full-stack-ci.mjs` or `ops/e2e-spec-coverage.test.ts` fails.

- **From Depends (T13):** as quoted above.

## Requirements

- `LeagueArchiveRepository.listLeagues()` returns the union of the server list and the local list. A failing server read (anonymous visitor, offline, 401/403) degrades to the local list alone and does **not** throw.
- Every read and write of a specific league routes by `isLocalLeagueId(id)`.
- `createLeague(name)` writes to the server when `canManageLeagues(role)` is true, and to the local store otherwise.
- `ensurePlaceholderLeague()` resolves to the server placeholder when the caller can write the server, and to the local placeholder otherwise.
- `moveTournament` refuses a cross-store move with a clear error rather than corrupting either store.
- The list page always offers the create affordance. The read-only notice appears only when there are server leagues the visitor cannot manage.
- Local rows carry a visible "local only" badge and an explanatory notice above the grid.
- Per-league write gating replaces the four role-only `canManage` computeds.
- Every successful command replaces the component's state with the returned document; every failed command reloads from the store before showing the error (assumption A5).

## Inputs

- `docs/adr/0028-dual-source-league-archive.md`
- `src/app/data/league-archive-repository.service.ts` — all 22 delegating methods.
- `src/app/data/league-archive-command-ux.ts` — `canManageLeagues`, `leagueCommandError`.
- `src/app/data/league-archive-origin.ts` and `src/app/backend/local-league-archive-backend.service.ts` — from T12/T13.
- `src/app/backend/application-backend.ts` — `LEAGUE_ARCHIVE_BACKEND`; read only.
- The four components listed above.
- `src/app/features/live-tournaments/live-tournament-list.component.ts` — the UI precedent.
- `cypress/e2e/live-local.cy.js` — the signed-out spec pattern to copy.
- `scripts/full-stack-ci.mjs` — the `runCypress('cypress/e2e/…')` list.
- `ops/e2e-spec-coverage.test.ts` — the gate that fails on an unwired spec.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/data/league-archive-routing.test.ts` (pure) and `src/app/data/league-archive-repository.service.test.ts` (repository, with two fake backends) first. Both fail.
2. **Green** — add the routing helpers, rewrite the repository, then update the four components and the templates.
3. **Refactor** — only if needed. Keep green.

## Test plan

New pure helpers in `src/app/data/league-archive-command-ux.ts`:

```ts
import { isLocalLeagueId } from './league-archive-origin';

/** A league in this browser is owned by whoever can see it; a server league needs the role (ADR 0028). */
export function canManageLeague(leagueId: string | null | undefined, role: GlobalRole | null | undefined): boolean {
  return isLocalLeagueId(leagueId) || canManageLeagues(role);
}

/** Where a brand-new league is written. */
export function createLeagueTarget(role: GlobalRole | null | undefined): 'server' | 'local' {
  return canManageLeagues(role) ? 'server' : 'local';
}
```

| Test | Input | Expect |
| --- | --- | --- |
| `a local league is manageable by anyone` | `canManageLeague('local-abc', undefined)`, `canManageLeague('local-abc', 'User')` | `true` for both |
| `a server league needs the role` | `canManageLeague('7f3a', undefined)`, `canManageLeague('7f3a', 'User')` | `false` for both |
| `an organizer manages server leagues` | `canManageLeague('7f3a', 'Organizer')`, `canManageLeague('7f3a', 'Admin')` | `true` for both |
| `new leagues go local for the unprivileged` | `createLeagueTarget(undefined)`, `createLeagueTarget('User')` | `'local'` for both |
| `new leagues go to the server for the privileged` | `createLeagueTarget('Organizer')`, `createLeagueTarget('Admin')` | `'server'` for both |
| `listing merges both stores` | repository with a server fake returning `[S1, S2]` and a local fake returning `[L1]` | `listLeagues()` has length 3 and contains all three ids |
| `a failing server read degrades to local` | server fake rejects with `{ status: 401 }` | `listLeagues()` resolves to `[L1]`, does not throw |
| `a failing server read is not silent` | same | `repository.serverUnavailable()` (a signal or flag the list page can read) is `true` |
| `both stores failing propagates` | both fakes reject | `listLeagues()` rejects |
| `reading a local id hits the local store only` | `getLeague('local-1')` | the local fake was called; the server fake was not |
| `reading a server id hits the server only` | `getLeague('7f3a')` | the server fake was called; the local fake was not |
| `creating as an anonymous visitor writes local` | no profile, `createLeague('Summer')` | the local fake's `createLeagueArchive` was called; the server fake's was not |
| `creating as an organizer writes the server` | profile role `Organizer` | the server fake's `createLeagueArchive` was called; the local fake's was not |
| `every write routes by id` | for each of rename, status, delete, tournament create/edit/delete, round add/delete/import/replace, entry add/edit/delete, archetype, player rename — call once with `'local-1'` and once with `'7f3a'` | the matching fake receives the call and the other receives nothing. **One assertion per method; there are 17.** |
| `the unassigned name resolves per authority` | `createLeague('Unassigned Tournaments')` as anonymous / as Organizer | resolves the **local** placeholder / the **server** placeholder |
| `a cross-store move is refused` | `moveTournament(t, 'local-1', '7f3a')` and `moveTournament(t, '7f3a', 'local-1')` | both reject with message `crossAuthorityMoveNotSupported`; neither fake was asked to write |
| `a same-store move is delegated` | `moveTournament(t, 'local-1', 'local-2')` | the local fake's `moveArchiveTournament` was called with both versions |
| `the list page always offers create` | `league-archive-list.component.ts` source | `data-cy="leagues-archive-list-create-card"` is **not** guarded by `@if (canManage())` |
| `local rows are badged` | same source | contains `data-cy="leagues-archive-list-item-local-badge"` inside an `@if` on the row's local-ness |
| `the local notice explains the store` | same source | contains `data-cy="leagues-archive-local-notice"` |

Cypress, new spec `cypress/e2e/league-local.cy.js`, signed out with `POST **/api/auth/refresh` stubbed 401 (copy the pattern from `live-local.cy.js`):

1. Stub every `**/api/league-archives*` request to reply 401 and record the URL, so the spec proves the local path never depends on the server.
2. Visit `/leagues-archive`, clearing `indexedDB.deleteDatabase('gones-leagues')` in `onBeforeLoad`.
3. Assert `[data-cy="leagues-archive-local-notice"]` is visible and `[data-cy="leagues-archive-list-create-card"]` exists.
4. Create a league, land on its detail page, add a tournament, add a round, add an entry.
5. Reload; assert everything survives — that is the IndexedDB proof.
6. Assert every recorded server URL was answered 401 and the UI never showed an error banner.

## Impl steps

- [ ] 1. Add `canManageLeague` and `createLeagueTarget` to `src/app/data/league-archive-command-ux.ts` exactly as written above.
- [ ] 2. Create `src/app/data/league-archive-routing.test.ts` with the five pure cases. Run it — green.
- [ ] 3. Create `src/app/data/league-archive-repository.service.test.ts`. Build two hand-written fakes implementing `LeagueArchiveBackendPort` with `vi.fn()` per method, plus a fake `AuthService` exposing `profile: signal<UserProfileResponse | null>`. Construct the repository through `runInInjectionContext` with a bare `Injector`, following the pattern in `src/app/features/calendar/public-calendar.component.test.ts`. Write every repository case above.
- [ ] 4. Run `npx vitest run src/app/data/league-archive-repository.service.test.ts` — it must fail.
- [ ] 5. Rewrite `src/app/data/league-archive-repository.service.ts`:
      a. Inject all three: `private readonly server: LeagueArchiveBackendPort = inject(LEAGUE_ARCHIVE_BACKEND);`, `private readonly local = inject(LocalLeagueArchiveBackend);`, `private readonly auth = inject(AuthService);`
      b. `readonly serverUnavailable = signal(false);`
      c. `private port(id: string): LeagueArchiveBackendPort { return isLocalLeagueId(id) ? this.local : this.server; }`
      d. `private writePort(): LeagueArchiveBackendPort { return createLeagueTarget(this.auth.profile()?.globalRole) === 'local' ? this.local : this.server; }`
      e. ```ts
         async listLeagues(): Promise<PersistedLeague[]> {
           const [server, local] = await Promise.allSettled([this.server.listLeagueArchives(), this.local.listLeagueArchives()]);
           this.serverUnavailable.set(server.status === 'rejected');
           if (server.status === 'rejected' && local.status === 'rejected') throw server.reason;
           return [
             ...(server.status === 'fulfilled' ? server.value : []),
             ...(local.status === 'fulfilled' ? local.value : [])
           ];
         }
         ```
      f. `getLeague(id)` → `this.port(id).getLeagueArchive(id)`.
      g. `createLeague(name, idempotencyKey)` → if `isUnassignedLeagueName(name)` return `this.ensurePlaceholderLeague()`; else `this.writePort().createLeagueArchive(name, idempotencyKey)`.
      h. `ensurePlaceholderLeague()` → read `LOCAL_PLACEHOLDER_LEAGUE_ID` from the local store when `createLeagueTarget(role) === 'local'`, else `PLACEHOLDER_LEAGUE_ID` from the server; throw `Error('placeholderLeagueMissing')` when absent.
      i. Change every remaining method that takes a `PersistedLeague` or an id to call `this.port(league.id)` / `this.port(id)` instead of `this.backend`. There are 17 of them; change each one.
      j. `moveTournament(tournamentId, fromLeagueId, toLeagueId)` — resolve `targetLeagueId` as today, then `if (isLocalLeagueId(fromLeagueId) !== isLocalLeagueId(targetLeagueId)) throw new Error('crossAuthorityMoveNotSupported');` before any read, then delegate to `this.port(fromLeagueId)`.
- [ ] 6. Run step 4's command — green.
- [ ] 7. In `src/app/i18n/messages.ts`, add to `en`:
      ```
      'leagues.localBadge': 'Local only',
      'leagues.localNotice': 'Leagues you create while signed out are stored in this browser only. They are never sent to the server.',
      'leagues.serverUnavailable': 'Server leagues could not be loaded. Only the leagues stored in this browser are shown.',
      'leagues.crossAuthorityMove': 'A tournament cannot be moved between a browser-stored league and a server league.',
      ```
      and to `fr`:
      ```
      'leagues.localBadge': 'Local uniquement',
      'leagues.localNotice': 'Les ligues créées hors connexion sont stockées uniquement dans ce navigateur. Elles ne sont jamais envoyées au serveur.',
      'leagues.serverUnavailable': 'Les ligues du serveur n’ont pas pu être chargées. Seules les ligues stockées dans ce navigateur sont affichées.',
      'leagues.crossAuthorityMove': 'Un tournoi ne peut pas être déplacé entre une ligue stockée dans le navigateur et une ligue du serveur.',
      ```
- [ ] 8. In `src/app/features/leagues-archive/league-archive-list.component.ts`:
      a. Replace `readonly canManage = computed(() => canManageLeagues(this.auth.profile()?.globalRole));` with `canManageLeague(league: PersistedLeague): boolean { return canManageLeague(league.id, this.auth.profile()?.globalRole); }` and add `readonly hasUnmanageableServerLeagues = computed(() => this.leagues().some((league) => !isLocalLeagueId(league.id)) && !canManageLeagues(this.auth.profile()?.globalRole));`
      b. Add `isLocal(league: PersistedLeague): boolean { return isLocalLeagueId(league.id); }`
      c. Above the grid, add:
         ```html
         <p class="muted" role="status" data-cy="leagues-archive-local-notice">{{ i18n.t('leagues.localNotice') }}</p>
         @if (repo.serverUnavailable()) { <p class="warning" role="status" data-cy="leagues-archive-server-unavailable">{{ i18n.t('leagues.serverUnavailable') }}</p> }
         ```
      d. Inside the row anchor, after the status span, add:
         ```html
         @if (isLocal(league)) { <span class="league-card-local-badge" data-cy="leagues-archive-list-item-local-badge">{{ i18n.t('leagues.localBadge') }}</span> }
         ```
      e. Replace the `@if (canManage()) { …create card… } @else { …read-only… }` block with an unconditional create card followed by:
         ```html
         @if (hasUnmanageableServerLeagues()) { <p class="muted" data-cy="leagues-archive-list-read-only">{{ i18n.t('leagues.readOnly') }}</p> }
         ```
      f. Filter both placeholders out of `filteredLeagues` with `isAnyPlaceholderLeagueId(league.id)` instead of the single `PLACEHOLDER_LEAGUE_ID` check, keeping the existing "unless it holds tournaments" condition.
      g. In `leagueDisplayName`, use `isAnyPlaceholderLeagueId(league.id)` so the local placeholder also shows the translated "Unassigned" label.
- [ ] 9. In `src/app/features/leagues-archive/league-archive-detail.component.ts` line 81 and `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` line 193, change each `canManage` computed to read the loaded league's id: `readonly canManage = computed(() => canManageLeague(this.league()?.id, this.auth.profile()?.globalRole));` — check the actual signal name holding the league in each file first and use it.
- [ ] 10. In `src/app/app.component.ts` line 132, replace `canManageLeagueData` with a per-league form. It has two call sites (the league header actions and the tournament header actions); give it the id from `headerLeague()` / `headerTournament()?.league` respectively:
      ```ts
      readonly canManageHeaderLeague = computed(() => canManageLeague(this.headerLeague()?.id ?? this.headerTournament()?.league.id, this.auth.profile()?.globalRole));
      ```
      Update both template references. The `/leagues-archive` import button (`showHeaderImport()` branch) keeps a role-free gate: leave it visible to everyone, since T15 makes import work locally too — but for **this** commit, gate it on `canManageLeagues(role)` exactly as today so nothing half-wired ships. Add a one-line comment saying T15 relaxes it.
- [ ] 11. Add the component-source cases from the Test plan to a new `src/app/features/leagues-archive/league-archive-list.component.test.ts`.
- [ ] 12. Create `cypress/e2e/league-local.cy.js` per the Test plan.
- [ ] 13. In `scripts/full-stack-ci.mjs`, add `const leagueLocalBrowser = runCypress('cypress/e2e/league-local.cy.js');` next to the existing `leagueBrowser` line, and include its result in the same aggregation the other specs use — copy exactly what the neighbouring lines do with their return value.
- [ ] 14. Run `npx vitest run ops/e2e-spec-coverage.test.ts` — it must pass, proving the new spec is wired.
- [ ] 15. Run `npx vitest run src/app/data src/app/features/leagues-archive src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- New: `src/app/data/league-archive-routing.test.ts`, `src/app/data/league-archive-repository.service.test.ts`, `src/app/features/leagues-archive/league-archive-list.component.test.ts`, `cypress/e2e/league-local.cy.js`.
- Changed: `src/app/data/league-archive-command-ux.ts`, `src/app/data/league-archive-repository.service.ts`, `src/app/features/leagues-archive/league-archive-list.component.ts`, `src/app/features/leagues-archive/league-archive-detail.component.ts`, `src/app/features/tournaments-archive/tournament-archive-detail.component.ts`, `src/app/app.component.ts`, `src/app/i18n/messages.ts`, `src/styles.css` (badge rule), `scripts/full-stack-ci.mjs`.
- Public API for T15 to consume verbatim: `LeagueArchiveRepository.listLeagues()` returns the merged list; `LeagueArchiveRepository.serverUnavailable` is a `Signal<boolean>`; `canManageLeague(leagueId, role)` and `createLeagueTarget(role)` live in `src/app/data/league-archive-command-ux.ts`; `LeagueArchiveRepository` exposes `private port(id)` internally but T15 should route through the public methods.
- New `data-cy` values: `leagues-archive-local-notice`, `leagues-archive-server-unavailable`, `leagues-archive-list-item-local-badge`. New i18n keys: `leagues.localBadge`, `leagues.localNotice`, `leagues.serverUnavailable`, `leagues.crossAuthorityMove` (en + fr).

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npx cypress run --spec cypress/e2e/league-local.cy.js` passes
- [ ] `npx cypress run --spec cypress/e2e/league-server.cy.js` passes — the privileged path is unchanged
- [ ] Manual (signed out): `npm run dev`, `/leagues-archive` — the local notice is shown, the create card is offered, creating a league lands on its detail page, adding a tournament / round / entry all work, and everything survives a reload.
- [ ] Manual (signed out): DevTools → Network shows no successful `/api/league-archives` write; DevTools → Application → IndexedDB shows a `gones-leagues` database holding the rows.
- [ ] Manual (Admin): sign in as `admin@gones.test` — the list shows the server leagues **and** the local ones, with the local ones badged; opening a local one still allows editing; opening a server one still allows editing.
- [ ] Manual (plain user): sign in as `test@gones.test` — server leagues are read-only with the read-only notice; local leagues remain fully editable.
- [ ] Manual: try to move a tournament from a local league into a server league — it is refused with the `leagues.crossAuthorityMove` message and neither store changes.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `feat(leagues): merge the browser-local store into the league archive`
