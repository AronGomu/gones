# T3: Make Power User settings react to storage, and repair the six gated specs

**Plan:** `./artifacts/PLAN_2026_08_21_e2e-suite-repair.md`
**Depends:** T1
**Commit outcome:** Turning Power User mode on in one tab turns it on in the others — and the six specs that depend on that setting stop depending on a hook the release build never calls.

## Context (self-contained)

- Six cases fail against the release stack, each because a Power-User-gated element never renders:

  | Spec | Case | Missing element |
  | --- | --- | --- |
  | `power-user-gating.cy.js` | `keeps an anonymous local Live detail readable while mutations are off` | `create-running-tournament-card` |
  | `archive-staged-edit.cy.js` | `marks a local Tournament complete and can reopen it after reload` | `leagues-archive-list-create-card` |
  | `archive-staged-edit.cy.js` | `keeps server draft on 412, cancels Reload Latest without loss, then discards after confirmation` | `tournament-archive-detail-edit` |
  | `league-server.cy.js` | `redirects every retired league URL onto the archive surface, parameters intact` | `header-import-input` |
  | `league-server.cy.js` | `shows User read-only controls plus explicit 403 and 412 reload recovery` | `Role League` inside `h1 button` |
  | `organizer-event-management.cy.js` | `confirms delete impact, restores as Admin, handles server rejection, and remains usable in French on mobile` | `event-delete` |

  Every one of those elements sits behind `power.enabled()`, directly or through
  `canUsePowerMutation(power.enabled(), …)`.

- **Why the release build breaks them.** `ngsw-worker.js` calls `skipWaiting()` and `clients.claim()`,
  so once active it answers the navigation request from Cache Storage. The document never travels
  through the Cypress proxy, so Cypress cannot inject its `onBeforeLoad` script — **the hook simply
  never runs**, with no error. Every one of these specs seeds `gones.settings.power-user` inside
  `onBeforeLoad`. `cypress/e2e/offline-public-read.cy.js` already documents this behaviour in a
  comment, and commit `0cfb2be` already worked around it once.

- **Why a re-seed alone cannot fix it.** `src/app/shared/power-user-settings.service.ts:8` is
  `private readonly state = signal(readPowerUserSetting());` — storage is read **once, at
  construction**, and there is no `storage` listener. So writing the key after bootstrap changes
  nothing for the life of the page. Compare `src/app/shared/deck-archetype-settings.service.ts:30`,
  which *does* listen for `storage` and refresh — which is exactly why the same trick worked for the
  language in `0cfb2be`.

## Requirements

### The app change

- `PowerUserSettingsService` refreshes its signal when the Power User key changes in `storage`,
  mirroring the shape `DeckArchetypeSettingsService` already uses.
- **This must stand on its own merit as a feature, not as a test accommodation.** The user-visible
  behaviour it buys: toggling Power User mode in one tab takes effect in the others, instead of
  leaving them silently stale until reload. That is what a user expects, and it is the same
  behaviour the language setting already has. State that reasoning in the code comment.
- Guard it the way the existing service guards storage access — `power-user-settings.service.ts`
  already tolerates storage being unavailable (see its `catch`), and the listener must not regress
  that.
- Only react to the Power User key. Do not refresh on unrelated keys.
- Add a unit test that pins it: dispatch a `StorageEvent` for that key and assert the signal follows.
  Also pin that an unrelated key does **not** disturb it.

### The spec changes

- Each of the six specs must satisfy the gate in a way that survives `onBeforeLoad` never running.
  The established pattern in this repo is: keep the `onBeforeLoad` seed (it still works on a dev
  server and costs nothing), then after load detect that the seed did not land — a SEED_MARKER — and
  re-seed on the live window, dispatching a `StorageEvent` so the now-reactive service picks it up.
  `offline-public-read.cy.js` and commit `0cfb2be` are the two references; copy, do not reinvent.
- `organizer-event-management.cy.js` already has this pattern for the **language** key and its
  `seedLanguage()` already writes the power-user key — but the `StorageEvent` it dispatches names
  only `gones.settings.language`. Extend it rather than adding a parallel mechanism.
- Prefer one shared helper per spec file over repeating the dance in each case.

## Inputs

- `src/app/shared/power-user-settings.service.ts` — the non-reactive signal, and its storage guard
- `src/app/shared/deck-archetype-settings.service.ts` (~line 30) — the listener pattern to mirror
- `cypress/e2e/offline-public-read.cy.js` (~lines 21-28) — the documented SEED_MARKER technique
- `git show 0cfb2be` — the same technique applied to a real failing spec
- The six specs above
- Gate expressions, for reference while verifying:
  - `src/app/features/live-tournaments/live-tournament-list.component.ts:69` — `@if (canManage())`
  - `src/app/features/leagues-archive/league-archive-list.component.ts:58` — `@if (power.enabled())`
  - `src/app/features/leagues-archive/tournament-archive-detail.component.ts:42` — `canEdit()`
  - `src/app/app.component.ts:50` — `@if (power.enabled())`
  - `src/app/features/leagues-archive/league-archive-detail.component.ts:31` — `canManage()`
  - `src/app/features/events/organizer-event-list.component.ts:47` — `canEdit(event)`

## TDD

1. **Red** — unit test for the storage listener fails against the current service.
2. **Green** — add the listener.
3. Then the specs: confirm each of the six is red on the release stack, apply the SEED_MARKER
   pattern, confirm green.

## Impl steps

- [ ] 1. Write the `PowerUserSettingsService` storage-listener unit tests (reacts to its own key,
      ignores others, survives storage being unavailable). Run — red.
- [ ] 2. Add the listener. Run — green. Note in the comment why it exists (cross-tab sync).
- [ ] 3. Run `npm run test` — the whole frontend suite still green.
- [ ] 4. Bring up a clean release stack and reproduce all six e2e failures.
- [ ] 5. Add the SEED_MARKER + `StorageEvent` re-seed to `power-user-gating.cy.js`,
      `archive-staged-edit.cy.js` and `league-server.cy.js`.
- [ ] 6. Extend the existing re-seed in `organizer-event-management.cy.js` to cover the power-user key.
- [ ] 7. Re-run the four specs against the release stack — the six cases pass.
- [ ] 8. Re-run them against a dev server too: the change must not break the path that already worked.

## Outputs

- `src/app/shared/power-user-settings.service.ts` + its spec
- `cypress/e2e/power-user-gating.cy.js`, `archive-staged-edit.cy.js`, `league-server.cy.js`,
  `organizer-event-management.cy.js`
- No backend change.

## Validation

- [ ] `npm run test` → exit 0
- [ ] `npm run lint` → exit 0, `npm run typecheck` → exit 0
- [ ] Release stack: the six named cases pass
- [ ] Dev server: the same four specs still pass
- [ ] The listener test fails if the listener is removed (prove it, then restore)
- [ ] Manual: open the app in two tabs, toggle Power User mode in one, confirm the other follows
      without a reload
- [ ] commit msg draft: `fix(settings): follow the power user toggle across tabs`
