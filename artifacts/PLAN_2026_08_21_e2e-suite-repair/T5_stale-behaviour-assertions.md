# T5: Fix the two stale behaviour assertions

**Plan:** `./artifacts/PLAN_2026_08_21_e2e-suite-repair.md`
**Depends:** T1
**Commit outcome:** Two specs stop asserting behaviour the app deliberately changed.

## Context (self-contained)

Two unrelated failures, both stale rather than broken. They are grouped only because each is a
one-line class of fix.

### A. `auth-profile.cy.js` — logout destination

- Failing case: `logs in, updates private-by-default profile, changes email, signs out`.
- `cypress/e2e/auth-profile.cy.js:122` asserts `cy.location('pathname').should('eq', '/')` after
  clicking logout.
- Commit `8e76da1` ("send logout to sign-in and return the user where they were") changed logout to
  navigate to `/login?returnUrl=<page where logout was clicked>`
  (`src/app/app.component.ts:205-208`). The unit test
  `src/app/app.component.auth-entry.test.ts:106` already pins the new behaviour.
- That commit added a **new** spec for the new behaviour but never updated this older assertion. The
  test clicks logout from `/settings/account`, so the pathname is now `/login`.
- **The app is right; the assertion is stale.** Do not change the logout behaviour.
- While fixing it, check the assertion immediately after — the spec also asserts the logout button is
  gone, which should still hold on the sign-in page. Confirm rather than assume.

### B. `live-server.cy.js` — the Live list cache

- Failing case: `renders the sync bar on the list and a reload issues no new list request`, failing
  with ``cy.wait() timed out waiting 5000ms for the 1st request to the route: `liveList`. No request
  ever occurred.``
- `cypress/e2e/live-server.cy.js:338-340` wipes the `gones-cache` IndexedDB database inside an
  `onBeforeLoad` hook. On the release build that hook **never runs** — the ngsw service worker serves
  the navigation from Cache Storage, so the document never passes through the Cypress proxy. T3
  explains this mechanism in full; `cypress/e2e/auth-profile.cy.js:38-44` already documents it in a
  comment.
- So the wipe never happens, earlier tests have already populated `gones-cache`, and
  `live-tournament-list.component.ts:108` serves the list from the 24h TTL cache
  (`server-read-cache.service.ts:30,35`) without ever hitting the network. The `cy.wait('@liveList')`
  then times out.
- The cache behaviour under test is correct. The **setup** is what fails.
- Note `/api/live-tournaments` is in `NEVER_CACHEABLE_API_PATHS`
  (`src/app/api/service-worker-cache.ts:39`), so ngsw is not caching the API response — the app's own
  `gones-cache` is. Do not "fix" this by touching the service worker config.

## Requirements

- Both cases pass against the **release stack**.
- Neither fix weakens what the case proves:
  - A still proves that signing out ends the session and leaves no logout button — now at the correct
    destination.
  - B still proves that the sync bar renders **and** that a reload issues no new list request. The
    cache wipe is setup; the assertion about no-new-request is the point and must survive.
- Do not change app behaviour in this ticket. If either turns out to need an app change, stop and
  report — that would mean the diagnosis is wrong.
- For B, move the IndexedDB wipe onto the live window (the pattern the repo already uses for
  post-load work) rather than relying on `onBeforeLoad`. Keep the `onBeforeLoad` seed as well: it
  still works on a dev server and costs nothing.

## Inputs

- `cypress/e2e/auth-profile.cy.js` — line ~122, and the comment at ~38-44 describing the ngsw hook
  problem
- `src/app/app.component.ts:205-208` — the logout navigation
- `src/app/app.component.auth-entry.test.ts:106` — the unit test pinning it
- `cypress/e2e/live-server.cy.js` — lines ~330-345, the `onBeforeLoad` wipe and the `liveList` wait
- `src/app/features/live-tournaments/live-tournament-list.component.ts:108` — `readCached('live-tournaments', …)`
- `src/app/backend/server-read-cache.service.ts:30,35` — `gones-cache`, the 24h TTL

## TDD

Both tests exist and are red. Confirm red on the release stack, fix, confirm green. For B, prove the
assertion still bites: with the wipe working, the second navigation must genuinely issue no request —
if the case would pass even with the caching removed, the fix went too far.

## Impl steps

- [ ] 1. Reproduce both failures on a clean release stack.
- [ ] 2. A: update the logout destination assertion to `/login`, and confirm the following
      logout-button assertion still holds there.
- [ ] 3. B: move the `gones-cache` wipe out of `onBeforeLoad` and onto the live window, then reload
      so the list is fetched fresh.
- [ ] 4. Re-run both specs against the release stack.
- [ ] 5. Re-run both against a dev server — still green.
- [ ] 6. Confirm `git diff --stat` touches only files under `cypress/`.

## Outputs

- `cypress/e2e/auth-profile.cy.js`
- `cypress/e2e/live-server.cy.js`
- No app change, no backend change.

## Validation

- [ ] Release stack: both named cases pass
- [ ] Dev server: both specs still pass
- [ ] B still proves "a reload issues no new list request" — reason it through and say so explicitly
- [ ] `git diff --stat` shows only `cypress/` files
- [ ] commit msg draft: `test(e2e): assert the logout destination and wipe the live cache on the live window`
