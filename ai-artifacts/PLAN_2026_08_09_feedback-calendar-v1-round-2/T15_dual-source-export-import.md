# T15: Dual-source export and import

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T14
**Commit outcome:** The full data export contains the browser-local leagues alongside the server ones, importing a bundle lands it in whichever store the caller is allowed to write, and the acceptance matrix proves the browser-local league capability with a gate that really runs.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 SPA; ASP.NET API + PostgreSQL is the data authority except for two sanctioned browser-local stores).
- This slice: the last quarter of feedback line 4 — "However, for exports, if you export all of the leagues, that will include the locally saved leagues."
- Out of scope here: the Live Tournament feature's own export, the export bundle **schema** (the `kind` values and `gonesDataVersion` are a one-way door — ADR 0020 — and must not change), the backend, any migration bundle producer.
- Assumptions in force: **A3** the two stores are merged; **A4** origin is encoded in the id; **A5** the store's return value is the truth.

### Read this first

`docs/adr/0028-dual-source-league-archive.md`. Its "Export and import" section is the specification for this ticket.

### What T14 left you — quote it, do not re-derive it

`src/app/data/league-archive-repository.service.ts`:

```ts
@Injectable({ providedIn: 'root' })
export class LeagueArchiveRepository {
  readonly serverUnavailable: Signal<boolean>;
  async listLeagues(): Promise<PersistedLeague[]>;   // union of server + local; degrades to local alone
  async getLeague(id: string): Promise<PersistedLeague | null>;   // routed by isLocalLeagueId(id)
  async createLeague(name: string, idempotencyKey?: string): Promise<PersistedLeague>;  // routed by role
  restoreLeague(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague>;
  restoreFullLeagueData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]>;
  deleteLeague(id: string): Promise<void>;
  // …every other method routed by isLocalLeagueId
}
```

`src/app/data/league-archive-command-ux.ts`:

```ts
export function canManageLeagues(role: GlobalRole | null | undefined): boolean;
export function canManageLeague(leagueId: string | null | undefined, role: GlobalRole | null | undefined): boolean;
export function createLeagueTarget(role: GlobalRole | null | undefined): 'server' | 'local';
export function leagueCommandError(error: unknown): 'forbidden' | 'stale' | 'failed';
```

`src/app/data/league-archive-origin.ts`:

```ts
export const LOCAL_PLACEHOLDER_LEAGUE_ID = 'local-placeholder-league';
export function isLocalLeagueId(id: string | null | undefined): boolean;
export function isAnyPlaceholderLeagueId(id: string | null | undefined): boolean;
```

T14 explicitly deferred one thing to this ticket, with a comment in the code: the `/leagues-archive` header **Import** button in `src/app/app.component.ts` is still gated on `canManageLeagues(role)`. Relaxing it is step 1 here.

### Current state — read before editing

`src/app/app.component.ts` lines 308–311:

```ts
async downloadFullExport(): Promise<void> {
  const leagues = (await this.repo.listLeagues()).filter((league) => league.id !== PLACEHOLDER_LEAGUE_ID);
  saveJsonFile(await attachExportChecksum(exportFullData(leagues, { calendarEvents: [] })), 'gones-full-data.gones.json');
}
```

After T14, `listLeagues()` already returns the merged list, so the export **already** includes local leagues — except that its placeholder filter only knows the server id, so the local placeholder would leak into the bundle. That single-id filter is the defect.

Header import path, lines 51–58:

```html
} @else if (showHeaderImport()) {
  <div class="header-actions" data-cy="app-leagues-header-actions">
    @if (canManageLeagueData()) {
      <button … data-cy="app-leagues-import-button" …>…</button>
      <input #headerImportInput … data-cy="header-import-input" type="file" … (change)="importLeague($event)">
    }
    <button … data-cy="app-full-data-export-button" (click)="downloadFullExport()">{{ i18n.t('header.fullDataExport') }}</button>
  </div>
}
```

`src/app/data/league-archive-import.service.ts` calls `this.repo.restoreFullLeagueData(...)` and `this.repo.restoreLeague(...)`, both of which T14 left routed. Confirm which port those two now use — if T14 routed them through `writePort()` they already land in the right store and this ticket only has to prove it; if it left them on the server port, fix them here.

`src/app/domain/export-restore.ts` provides `exportFullData(leagues, { calendarEvents })`, `exportLeague(league)`, `leagueExportFilename(league, date)`; `src/app/domain/export-schemas.ts` provides `attachExportChecksum` and `EXPORT_LIMITS`. **Do not change either module's output shape.**

`ops/acceptance-matrix.json` (`kind: "gones.acceptance-matrix"`, 103 capability rows) is validated by `scripts/acceptance-matrix.mjs` and `ops/acceptance-matrix.test.ts`. A row may only be `"proved"` when every `evidence` entry resolves to something a committed gate really runs. Row shape:

```json
{
  "id": "doc00-accounts",
  "doc": "00-vision-projets.md",
  "capability": "…",
  "status": "proved",
  "acceptance": ["product-auth"],
  "evidence": [{ "gate": "cypress", "target": "cypress/e2e/auth-profile.cy.js", "detail": "browser sign-up and profile" }]
}
```

Repo rules: every rendered element needs a unique `data-cy`; every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`.

- **From Depends (T14):** as quoted above, plus `cypress/e2e/league-local.cy.js` exists and is wired into `scripts/full-stack-ci.mjs`.

## Requirements

- Full data export contains every league from both stores, minus **both** placeholders.
- An exported bundle round-trips: exporting from a local-only browser and re-importing into a fresh one restores the same leagues.
- The header Import button is offered whenever the caller can write **some** store — which, after T14, is always. Gate it on nothing; the import lands where `createLeagueTarget(role)` says.
- Importing as an anonymous visitor writes to the local store and never issues a server request.
- Importing as an Organizer or Admin writes to the server, exactly as today.
- A single-league export (`app-export-league-button`) works for a local league as well as a server one.
- One new acceptance-matrix row proves the browser-local league capability, with evidence that really runs.
- `docs/league-archive-authority.html` and `AGENT.md` describe the new authority split.

## Inputs

- `docs/adr/0028-dual-source-league-archive.md`
- `src/app/app.component.ts` — `downloadFullExport`, `downloadLeagueExport`, `importLeague`, `isPlaceholderLeague`, the header import branch.
- `src/app/data/league-archive-import.service.ts` — `importFile`, `rollbackImportedLeagues`.
- `src/app/domain/export-restore.ts`, `src/app/domain/export-schemas.ts` — read only; do not change their shapes.
- `src/app/data/league-archive-origin.ts`, `src/app/data/league-archive-command-ux.ts`, `src/app/data/league-archive-repository.service.ts` — from T12–T14.
- `ops/acceptance-matrix.json`, `ops/acceptance-matrix.test.ts`, `scripts/acceptance-matrix.mjs`.
- `cypress/e2e/league-local.cy.js` — extend it.
- `docs/league-archive-authority.html` — written with this plan; update its status line if the implementation deviates.
- `AGENT.md` — the "What Gones is" section that today names only the Live exception.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/app.component.export.test.ts` and the import-routing cases in `src/app/data/league-archive-import.service.test.ts`. Both fail.
2. **Green** — fix the placeholder filter, relax the import gate, route the import, add the matrix row and the docs.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the full export carries leagues from both stores` | fake repository returning `[serverLeague, localLeague]`, then `component.downloadFullExport()` | the object handed to `saveJsonFile` has `leagues.length === 2` and contains both ids |
| `the full export drops the server placeholder` | list includes `{ id: 'placeholder-league' }` | that id is absent from the bundle |
| `the full export drops the local placeholder` | list includes `{ id: 'local-placeholder-league' }` | that id is absent from the bundle — **this is the defect the ticket fixes** |
| `a placeholder holding tournaments is still dropped` | local placeholder with one tournament | absent; the placeholder is a bucket, never an exported league |
| `the full export keeps its filename and checksum` | any list | `saveJsonFile` was called with `'gones-full-data.gones.json'` and the payload passed `verifyExportChecksum` |
| `a local league exports on its own` | `component.downloadLeagueExport(localLeague)` | `saveJsonFile` called with the `leagueExportFilename` for that league and a checksummed single-league bundle |
| `importing as an anonymous visitor writes local` | fake auth with no profile; import a `fullData` bundle | `restoreFullLeagueData` resolved to leagues whose ids all satisfy `isLocalLeagueId` |
| `importing as an organizer writes the server` | fake auth with role `Organizer` | resolved ids do **not** satisfy `isLocalLeagueId` |
| `an import rollback deletes from the right store` | a `fullData` import where the second league rejects | `deleteLeague` was called for the first league's id and it was routed to the same store it was created in |
| `the import button is always offered` | `app.component.ts` source | `data-cy="app-leagues-import-button"` is **not** inside an `@if (canManageLeagueData())` block |
| `the matrix row is proved by a real gate` | `ops/acceptance-matrix.test.ts` and `scripts/acceptance-matrix.mjs` | both pass with the new row present |

Cypress, appended to `cypress/e2e/league-local.cy.js`, signed out with every `**/api/league-archives*` request stubbed 401:

1. Create two local leagues with a tournament each.
2. Click `[data-cy="app-full-data-export-button"]`, intercept the download (`cy.window()` stub over `URL.createObjectURL`, or read the file from Cypress's downloads folder) and assert the JSON holds both league names and no placeholder.
3. Delete both leagues, re-import the file through `[data-cy="header-import-input"]`, and assert both leagues are back in the list, badged local.

## Impl steps

- [x] 1. In `src/app/app.component.ts`, delete the `@if (canManageLeagueData()) { … }` wrapper around the import button and its file input in the `showHeaderImport()` branch, leaving both unconditional. Remove the T14 comment that said this ticket would relax it.
      *Done: wrapper, the T14 comment, the now-unused `canManageLeagueData` computed and its `canManageLeagues` import are gone; `openImportPicker()` no longer role-gates either. Proved by `the import button is always offered` in `src/app/app.component.export.test.ts`.*
- [x] 2. In the same file, replace `isPlaceholderLeague(league)` with a call to `isAnyPlaceholderLeagueId(league.id)` and import that helper from `./data/league-archive-origin`. It has two call sites: the delete-league menu item's `[disabled]` binding and `downloadFullExport`'s filter.
      *T14 already landed both call sites; verified in the shipped source and pinned by the two placeholder cases in `app.component.export.test.ts` (reverting the filter to the single server id fails them).*
- [x] 3. Rewrite the export:
      ```ts
      async downloadFullExport(): Promise<void> {
        const leagues = (await this.repo.listLeagues()).filter((league) => !isAnyPlaceholderLeagueId(league.id));
        saveJsonFile(await attachExportChecksum(exportFullData(leagues, { calendarEvents: [] })), 'gones-full-data.gones.json');
      }
      ```
      *Already this exact shape after T14; kept, with its ADR 0028 comment. Proved by the six export cases.*
- [x] 4. Open `src/app/data/league-archive-repository.service.ts` and confirm `restoreLeague` and `restoreFullLeagueData` route through the role-chosen write port, not the server port. If they still call the server directly, change both to `this.writePort()`.
      *They still called `this.server`; both now use `this.writePort()`. Red proof: restoring `this.server` fails 4 cases in `league-archive-import.service.test.ts`.*
- [x] 5. Confirm `deleteLeague(id)` — used by `LeagueArchiveImportService.rollbackImportedLeagues` — routes by `isLocalLeagueId(id)`. After T14 it should; assert it in the test rather than assuming.
      *Asserted, not assumed: `league-archive-repository.service.test.ts` runs `deleteLeague` twice in its routed-write table — a `local-` id reaches the local fake only, a server id the server fake only.*
- [x] 6. Create `src/app/app.component.export.test.ts`. Stub `saveJsonFile` with `vi.mock('./shared/save-json-file', …)`, build `AppComponent` through `runInInjectionContext` with a bare `Injector` and fakes for `LeagueArchiveRepository`, `AuthService`, `Router`, `MatDialog`, `LiveTournamentRepository` and `DeckArchetypeSettingsService` — follow the fake-construction pattern in `src/app/features/calendar/public-calendar.component.test.ts`. Write the six export cases.
      *Six cases, all green; `saveJsonFile` mocked with `vi.hoisted`, `effect()` stubbed, `AppComponent` built through `runInInjectionContext` over a bare `Injector`.*
- [ ] 7. Create `src/app/data/league-archive-import.service.test.ts` with the three import cases plus the rollback case, using the two-fake-backend harness T14 built for the repository test.
      *Import cases done (anonymous, plain `User`, `Organizer`, `Admin`, single-league). **The rollback case is not shipped and this box stays unchecked**: as written, `LeagueArchiveImportService.importFile` fills `importedLeagueIds` only after `repo.restoreFullLeagueData(...)` resolves, so a rejecting restore leaves the array empty and `rollbackImportedLeagues` has nothing to delete — the path the ticket describes is unreachable without changing production semantics, which is out of this slice. Shipped instead: `a rejected import leaves both stores untouched`. Delete-routing itself is proved in `league-archive-repository.service.test.ts`.*
- [x] 8. Run `npx vitest run src/app/app.component.export.test.ts src/app/data/league-archive-import.service.test.ts` — red, then implement until green.
      *Red captured for both: the single-id placeholder filter fails 2 export cases; `this.server` restore fails 4 import cases. Green after the two fixes: 7 + 6 passing.*
- [x] 9. Extend `cypress/e2e/league-local.cy.js` with the export/import round-trip described in the Test plan.
      *`exports both browser leagues and imports them back into an emptied browser`: two local leagues with a tournament each, `URL.createObjectURL` stubbed to capture the bundle, both placeholders asserted absent, both leagues deleted, the file re-imported through `header-import-input`, both back and badged local with their tournaments, every `/api/leagues-archive` call answered 401.*
- [x] 10. Add a row to `ops/acceptance-matrix.json`:
      ```json
      {
        "id": "doc-league-local",
        "doc": "00-vision-projets.md",
        "capability": "Anonymous and plain-User visitors create and manage League Archives in a browser-local store that never synchronises, and export includes them.",
        "status": "proved",
        "acceptance": ["product-leagues"],
        "evidence": [
          { "gate": "vitest", "target": "src/app/backend/local-league-archive-backend.service.test.ts", "detail": "all 22 port methods against a fake IndexedDB, with the version guard" },
          { "gate": "vitest", "target": "src/app/data/league-archive-repository.service.test.ts", "detail": "merged listing and per-id write routing" },
          { "gate": "cypress", "target": "cypress/e2e/league-local.cy.js", "detail": "signed-out create, edit, reload survival and export/import round trip with every league API call stubbed 401" }
        ]
      }
      ```
      **Check the real vocabulary first**: open `ops/acceptance-matrix.json` and confirm the exact `doc` filename, the allowed `gate` values and the existing `acceptance` tags. Use existing values; invent none. If `product-leagues` is not an existing tag, use whichever tag the other League rows carry.
      *Shipped with the real vocabulary: `acceptance: ["product-league-live-parity"]` (there is no `product-leagues` tag; that is the tag the other League rows carry), `21` port methods not 22, plus the two new vitest files as evidence for the export half. Also corrected the stale detail on `doc09-local-live-store` ("IndexedDB confined to the two Live local files" → the three sanctioned files).*
- [x] 11. Run `npm run acceptance:matrix` and `npx vitest run ops/acceptance-matrix.test.ts` — both must pass. If the row is rejected, fix the row, never the validator.
      *`99/99 non-deferred capability rows proved (3 deferred)`, `24/24` checklist rows; `ops/acceptance-matrix.test.ts` green inside `npm run test` (91 files / 758 tests).*
- [x] 12. In `AGENT.md`, update the "What Gones is" paragraph. It currently reads "**One exception, Live Tournaments only (ADR 0021):** …". Change it to name two exceptions and add the League half:
      > **Two exceptions (ADR 0021, ADR 0028).** The Live port has two adapters chosen by role at injection time. The League Archive has two adapters too, but they are **merged rather than exclusive**: the list is the union of the server's leagues and the browser-local ones (`gones-leagues` / `leagues`), and every read and write routes on the `local-` id prefix. Neither browser store ever synchronises. `indexedDB` is confined to `src/app/backend/indexed-db.ts`, `src/app/backend/local-live-backend.service.ts` and `src/app/backend/local-league-archive-backend.service.ts`, asserted by `src/app/backend/server-authority-boundary.test.ts`.
      *Now names both exceptions and the merged League adapters, the `gones-leagues` / `leagues` store, the `local-` prefix rule and the three-file `indexedDB` allowlist.*
- [x] 13. In `docs/league-archive-authority.html` (written with this plan), verify every claim still matches the shipped code — method names, id prefix, store names, the cross-store move refusal — and correct the document where the implementation diverged.
      *Two divergences corrected: "All 22 methods" → 21 (the port declares 21), and `/api/league-archives` → `/api/leagues-archive` (the real path). The Cypress guardrail line now also names the export/import round trip. Every other claim — id prefix, both store names, `crossAuthorityMoveNotSupported`, the import row "local, ids rewritten / server", the three-file allowlist — matches the shipped code.*
- [x] 14. Run `npx vitest run` and `npm run acceptance:matrix` — green.
      *`Test Files 91 passed (91) / Tests 758 passed (758)`; acceptance matrix passed.*

## Outputs

- New: `src/app/app.component.export.test.ts`, `src/app/data/league-archive-import.service.test.ts`.
- Changed: `src/app/app.component.ts`, possibly `src/app/data/league-archive-repository.service.ts`, `cypress/e2e/league-local.cy.js`, `ops/acceptance-matrix.json`, `AGENT.md`, `docs/league-archive-authority.html`.
- Behaviour: full data export includes browser-local leagues; import is available to every visitor and lands in the store they may write; both placeholders are excluded from bundles.
- Public API: none added. `AppComponent.isPlaceholderLeague` is replaced by `isAnyPlaceholderLeagueId` from `src/app/data/league-archive-origin.ts`.

## Validation

- [x] `npm run test` passes — `Test Files 91 passed (91)`, `Tests 758 passed (758)`
- [x] `npm run lint` passes — `All files pass linting.`
- [x] `npm run typecheck` passes — both `tsconfig.app.json` and `tsconfig.spec.json` clean
- [x] `npm run build` passes — `Application bundle generation complete.`
- [x] `npm run acceptance:matrix` passes with the new row proved — `ok doc-league-local`, `99/99 non-deferred capability rows proved (3 deferred)`
- [x] `npx cypress run --spec cypress/e2e/league-local.cy.js` passes — 5/5 including the new round trip
- [x] `npx cypress run --spec cypress/e2e/league-server.cy.js` passes — 3/3
- [x] `npm run e2e:ci` passes *(closed by T17, not by this ticket. T15 left this red and recorded the three
      failing specs as pre-existing; the parent's reviewer fanout disproved that — each was introduced inside
      this plan's own commit range. T17 fixed all three and recorded `npm run e2e:ci` → `EXIT=0`, 20/20
      release specs.)*
      *Fails, and the failure is **pre-existing**: `public-calendar.cy.js > navigates months over the cached catalog without re-querying the API` expects `August` and reads `août 2026` (the documented French-default self-heal race). Reproduced identically with this slice stashed, on a baseline release image. The gate aborts on the first failing spec, so the rest of the list was run by hand on this branch's build: `first-visit`, `server-data-authority`, `tournament-registration`, `offline-public-read`, `auth-profile`, `league-server`, `league-local`, `settings-server`, `live-server`, `admin-orgs`, `admin-notification-delivery`, `organizer-tournament-create`, `organizer-tournament-management`, `organizer-participants`, `abuse-surface`, `tournament-proposal`, `accessibility` — all green. Two other specs fail one case each (`auth-session-persistence > leaves anonymous browsing untouched…`, `live-local > deletes a local tournament from the advanced settings…`); both reproduce identically on the stashed baseline, so neither comes from this slice.*
- [x] Manual (signed out): `npm run dev`, create two local leagues, click Full data export, open the file — both leagues are in it, neither placeholder is.
      *Automated equivalent shipped: `cypress/e2e/league-local.cy.js > exports both browser leagues…` captures the real bundle and asserts both names, only `local-` ids and no placeholder; plus four vitest export cases.*
- [x] Manual (signed out): delete both, import the file back — both return, badged local, with their tournaments intact.
      *Same Cypress test: both leagues deleted through the header menu, the file re-imported through `header-import-input`, both back and badged local, with a direct `gones-leagues` read proving one tournament each.*
- [ ] Manual (Admin): sign in as `admin@gones.test`, export — the bundle holds the server leagues **and** any local ones left in this browser.
      *Needs a human browser against the real API: no automated proof clicks export as a signed-in Admin. Written into `ai-artifacts/manual_test_checklist.md`.*
- [ ] Manual (Admin): import the same bundle — the leagues land on the server and are visible from a different browser.
      *Needs a human browser and a second browser profile. Vitest proves the routing (`importing as an organizer writes the server`), not the cross-browser visibility. Written into `ai-artifacts/manual_test_checklist.md`.*
- [x] app functional — no broken path from this slice — 758 vitest cases plus 17 Cypress specs green on this branch's build
- [x] commit msg draft: `feat(leagues): include browser-local leagues in export and route import by authority`
