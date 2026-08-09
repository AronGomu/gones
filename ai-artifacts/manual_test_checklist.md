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
