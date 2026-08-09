# Manual test checklist — things a human must click that no automated test covers.

## T22 registrations-page-polish

- [ ] Signed in, open the home menu (`/`): a "Mes inscriptions" card appears between the Calendar card and the Settings card, with the description "Consultez les tournois auxquels vous êtes inscrit et annulez une inscription."
- [ ] Click that card: it navigates to `/registrations`.
- [ ] On `/registrations`, a "Retour au menu" button sits above the page title and a second one below the last section; both go back to the home menu.
- [ ] On `/registrations`, there is no "Compte" kicker above the "Mes inscriptions" title.
- [ ] Each registration card still shows its organization name ("Gones") above the tournament title — that kicker must survive.
- [ ] Sign out, open `/`: the "Mes inscriptions" card is gone.
- [ ] Signed out, navigate straight to `/registrations`: you are bounced to `/login`.
- [ ] Switch the app language to English in Settings and reload `/registrations`: the card description and the return buttons read in English, with no missing-key placeholders.
- [ ] At 375px width, `/registrations` has no horizontal scrollbar and both return buttons stay reachable.

## T23 backend-archive-rename

- [ ] After `docker compose run --rm migrator database update`, the existing archived Leagues are all still listed by `curl http://127.0.0.1:5080/api/leagues-archive` — the rename must not have lost a row.
- [ ] `curl http://127.0.0.1:5080/api/leagues` returns 404, and so do `/api/leagues/{id}` and `/api/leagues/{id}/export`: there is no alias for the old paths (ADR 0022).
- [ ] `curl http://127.0.0.1:5080/api/leagues-archive/{id}/tournaments-archive/{tournamentId}` returns the tournament, while the same URL with `/tournaments/` returns 404.
- [ ] Signed in as Organizer, create a League through the UI: the request goes to `/api/leagues-archive` and the `Location` header comes back as `/api/leagues-archive/{id}` (check the browser Network tab).
- [ ] Signed in as Organizer, download a League export and confirm the file still opens with `"kind": "league"` and a `"league"` object — the bundle format is frozen and must not mention "archive".
- [ ] Restore that same downloaded bundle through the restore screen: it is accepted and creates a new League. A bundle exported *before* this change must also still restore.
- [ ] Run a Live Tournament to the end and finalize it as Organizer: the response still carries a `leagueId`, and the finalized tournament shows up inside the target League Archive.
- [ ] Signed in as Organizer, open the player-name maintenance screen and commit a rename: it still works (its `/api/maintenance/player-names*` routes are deliberately not renamed, and its raw SQL now reads `league_archive_aggregates`).
- [ ] Calendar, sign-in/sign-up and the Admin dashboard are all unaffected — spot-check one page of each.
- [ ] Roll back check (optional, destructive — dev stack only): `dotnet ef database update AddTournamentProposals` puts the rows back under `league_aggregates` with no data loss, and re-applying restores them.

## T24 frontend-archive-rename

- [ ] Paste each retired URL into the address bar and press Enter — every one must land on its `-archive` twin with the parameters intact and the page rendered (not the catch-all 404): `/leagues` → `/leagues-archive`; `/leagues/{id}` → `/leagues-archive/{id}`; `/leagues/{id}/tournaments/{tid}` → `/leagues-archive/{id}/tournaments-archive/{tid}`; the same with `/result` and with `/result/metagames`.
- [ ] A real pre-rename bookmark (one saved by the browser before this change, or a `/leagues/...` link in an old email) still opens the right page after the redirect.
- [ ] On the home menu (`/`), the league card reads "Ligues (archive)" in French and "Leagues (archive)" in English, with the description mentioning the archived leagues in both languages and no missing-key placeholder.
- [ ] Clicking that card goes to `/leagues-archive` and the header Import control is visible there — it must not appear on any other page.
- [ ] Breadcrumbs on `/leagues-archive`, `/leagues-archive/{id}` and `/leagues-archive/{id}/tournaments-archive/{tid}` read "Ligues (archive)" / "Ligue (archive)" (and their English equivalents), and every crumb link navigates to an `-archive` URL.
- [ ] Export a League from the archive detail page, then restore that same file through the header Import control: the League comes back complete (tournaments, rounds, entries, standings). A bundle exported *before* this rename must also restore — the bundle format is frozen and its JSON must still say `"kind": "league"`.
- [ ] Export the full data set, wipe local data, restore it: everything comes back and no screen shows a broken `/leagues/...` link.
- [ ] Run a Live Tournament to the end and finalize it as Organizer: the app navigates to `/leagues-archive/{leagueId}/tournaments-archive/{tournamentId}` and the finalized tournament is rendered there.
- [ ] With the browser-local Live store (anonymous or plain user), finalizing still downloads the bundle instead of navigating — the rename must not have turned that into a navigation to an empty league id.
- [ ] Open `/leagues-archive/{id}` directly in a fresh tab (no history) and click the Back button: with no history to pop, it falls back to `/leagues-archive`, never to `/leagues`.
- [ ] Offline check: load `/leagues-archive` and a couple of archive detail pages online, then go offline (DevTools → Network → Offline) and reload them — they still render from the service-worker cache, because the cached API paths are now `/api/leagues-archive*` / `.../tournaments-archive/*`.
- [ ] Still offline, confirm no request to an old `/api/leagues/...` path is attempted (DevTools → Network) — a stale entry there would silently miss the cache.
- [ ] After deploying, a hard reload picks up the new service worker: the old `public-league-reads` cache group is gone and `public-league-archive-reads` is in use (DevTools → Application → Cache Storage).

## T25b inherited-cypress-repairs

This ticket changed **no application behaviour** — all six repaired Cypress failures were defects in the
specs, not in the product (see the ticket file for the per-spec verdict and evidence). The checks below
exist because settling them turned up user-visible behaviour that only the release build exercises, and
because "the suite is green" must not be the only thing that ever confirmed it. Run these against the
**release topology** (`docker compose --profile release`, `http://127.0.0.1:8081`), not `ng serve` — the
service worker is disabled under `ng serve`, and that difference is exactly what hid these failures.

- [ ] Signed in on the release build, open `/`: the "Mes inscriptions" card is present. This is the card whose absence the failing spec was reporting; confirm by eye that a real signed-in user gets it, with the service worker active (DevTools → Application → Service Workers shows `ngsw-worker.js` activated).
- [ ] Reload `/` a second time so the page is served by the service worker rather than the network: the card is still there and the toolbar still shows your username.
- [ ] In a fresh profile (or after Clear site data), open `/`: you are sent to `/about` exactly once. Navigate back to `/`: you now stay on `/` and see the home menu.
- [ ] In a fresh profile, deep-link straight to `/login`, sign in, then sign out. You land on `/about`, not `/`, because that browser has still never completed a first visit. Confirm this reads as intended onboarding — if it does not, the guard wiring (`firstVisitHomeGuard` on `''`, `markVisitedGuard` only on `/about`) is what to revisit, not the spec.
- [ ] Same fresh profile, signed in as a non-Admin: open `/admin/users`. You are refused and sent to `/?denied=…`. On a browser that has already completed a first visit the denial notice is visible on the home page; on a brand-new profile the About redirect swallows it. Confirm that losing the notice in that one case is acceptable.
- [ ] Load `/calendar` online, then switch DevTools → Network → Offline and reload: the tournaments you already saw still render, and the offline banner ("You are offline…" / "Vous êtes hors ligne…") is visible above the list.
- [ ] Go offline *first*, then navigate to `/calendar` in a tab that has visited it before: the app boots from the service worker cache, the cached tournaments render, and the same offline banner is shown. This is the affordance the failing spec claimed had been lost — it has not.
- [ ] While offline on a tournament page, try to register: the write is refused with "Nothing was queued or changed" and no request leaves the browser (DevTools → Network shows none).
- [ ] Run `npm run e2e:ci` on a clean checkout and confirm `auth-session-persistence.cy.js` now appears in the run output — the gate had been silently skipping it, and running it is what uncovered the sixth failure.
- [ ] Before hand-running `cypress/e2e/auth-profile.cy.js` on its own, re-run `node scripts/seed-auth-e2e.mjs`: that spec mutates the shared seeded account (it publishes the location), so a stale account makes its first assertion fail for reasons unrelated to the code under test.

## T25 data-cy-sweep-and-matrix

This ticket changed **identifiers only** — 24 component files gained `data-cy` attributes and not one
line of markup structure, styling or logic moved. The automated proof is that the set of `data-cy`
values in `src/app` went from 1079 to 1891 with **zero removed and zero changed**, and that
`npm run e2e:ci` stayed at 18/18. So the point of this list is *not* to re-test features: it is to
put human eyes on the handful of places where an attribute-only edit could still have gone wrong,
and to check that the release documents this ticket wrote are actually true.

Run the UI checks against the **release topology** (`docker compose --profile release`,
`http://127.0.0.1:8081`), same as T25b.

### Nothing renders differently

- [ ] Walk the swept pages and confirm each looks and behaves exactly as before: `/about`, `/calendar`, a tournament detail page, `/players/{name}`, `/live-tournaments`, a Live tournament runner, `/organizer/tournaments`, a participants page, `/organizations`, an organization detail, `/admin`, `/admin/users`, `/admin/organizations`, `/admin/audit`, `/admin/notifications/history`, `/admin/tournaments/deleted`, and a deliberately bad URL for the 404 page. Nothing should have shifted by a pixel.
- [ ] On `/about`, scroll the whole page: the section reveal animation still fires (elements fade/slide in as they enter the viewport). The sweep added attributes right next to the `data-reveal` attributes that drive it, so a typo there would silently kill the animation without breaking anything else.
- [ ] Open a confirm dialog (e.g. cancel a tournament from `/organizer/tournaments`) and a text-prompt dialog (e.g. create a League from the archive): both render, both buttons work, and Escape still cancels. `dialogs.ts` is shared by many call sites, so it is the single highest-blast-radius file in the sweep.

### The places where an identifier had to be repeated on purpose

- [ ] `/organizer/tournaments/{id}/participants` at a **desktop** width: the participant table shows Remove / Block / Remove-and-block, and each button works. Then narrow to ~375px: the card list shows the same three buttons and they still work. Both layouts are in the DOM at once and deliberately share `participant-remove`, `participant-block` and `participant-remove-block`; the card-list copies are written as `[attr.data-cy]="'participant-remove'"` bindings. In DevTools, inspect a card button and confirm the rendered attribute really is `data-cy="participant-remove"` — if it renders empty, the binding form was mistyped and Cypress would still pass while a human selector would not.
- [ ] Same page: trigger a load failure (stop the API, reload) and confirm the error block with its Retry button appears; then trigger an action failure (e.g. remove a participant with the API down) and confirm that error appears too. Both use `data-cy="participant-error"` from mutually exclusive branches.
- [ ] `/players/{name}` for a player with no recorded nemesis/rival: the two stat cards show the "n/a" text. Inspect them and confirm they carry `data-cy="stat-nemesis"` / `data-cy="stat-rival"`, same as the button form does for a player who has them.

### Identifiers that are now computed

- [ ] Account settings → Location: pick a city whose name contains an apostrophe or a space (`L'Arbresle`, `Montier-en-l'Isle`). Inspect the rendered option and confirm the attribute is `data-cy="account-location-city-L'Arbresle"` — the raw city name, **not** a slug. This was a deliberate decision (slugifying would have changed rendered output and required editing a component this ticket was told not to touch). Confirm the value is still selectable in DevTools with `document.querySelector('[data-cy="account-location-city-L\'Arbresle"]')`.
- [ ] Any page with a back button, top and bottom (e.g. a tournament detail page): both buttons work. Their identifiers are now position-suffixed (`back-button-link-top` / `back-button-link-bottom`), so a page that renders two of them no longer produces two identical ids.
- [ ] Known cosmetic wrinkle, **not** a regression to fix here: `/players/{name}` renders its footer back button with `position="top"`, so that page has two `…-top` back-button identifiers. This is pre-existing markup the sweep was not allowed to change. Confirm both back buttons on that page still work, then decide whether the footer's `position` deserves its own ticket.

### The checker itself

- [ ] `npm run test` passes and `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts` is `[]`. Re-adding a path there is a regression, not a workflow.
- [ ] Sanity-check the gate actually bites: temporarily delete one `data-cy` from any component template, run `npm run test -- data-cy-coverage`, confirm it fails naming that file, then restore it.
- [ ] Read the comment above `findDuplicateDataCy`. It records why the check was left textual instead of being taught about `@if` branches. Confirm you agree with that reasoning before anyone relaxes the rule — the deciding case is `organizer-participants.component.ts`, where the duplicate ids are simultaneously in the DOM and branch-awareness would not have helped.

### The release certification this ticket wrote

- [ ] `npm run acceptance:matrix` passes and reports `98/98 non-deferred capability rows proved (3 deferred)`. The 3 deferred rows are the pre-existing live-infrastructure ones (public hosting, real OAuth apps, real email deliverability) — confirm this plan added none.
- [ ] Spot-check three of the seven rows this ticket added by actually running their evidence, not by reading it: `doc04-account-deletion`, `doc05-full-catalog-cache` and `doc09-first-visit`. A matrix row is only worth what its evidence executes.
- [ ] Read the new "The feedback release" section of `docs/RELEASE_NOTES_V1.md` end to end against what you just clicked through. Every bullet should describe something you can reproduce; anything you cannot reproduce is the note being wrong, not the app.
- [ ] Confirm the section names all **seven** ADRs (0021–0027). 0027 (`external-identity-link-without-reauthentication`) is the one an earlier draft of the plan omitted, and it records a real security trade-off: linking or unlinking an external identity no longer requires the password. Read that ADR and confirm the release is willing to ship that.

### The three known gaps, verified as gaps

These are recorded in the release notes as **not fixed**. Confirm each is genuinely as described, so the
notes do not understate a problem.

- [ ] Read-only Live UI: sign in as every role in turn (anonymous, plain user, Organizer, Admin) and confirm none of them can reach a read-only Live surface — `live-read-only` / `live-list-read-only` really are unreachable. If any role still hits it, the release notes are wrong and the elements are live code.
- [ ] `npm run notification:smoke` twice in a row against the same database: the first run passes, the second fails on the `notification_history` foreign key. Confirm the failure is exactly that and nothing worse.
- [ ] Tournament proposals: the flow is proved by backend integration tests, **not** by a live-stack journey, because the proposal tables have no grants for the local `gones_app` role. Try `docker compose up -d permissions` and then a real end-to-end proposal → mailed link → publish against the running stack. If that fixes it, say so on the follow-up ticket; do not silently upgrade the release note.
