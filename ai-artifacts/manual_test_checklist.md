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
- [ ] ~~Tournament proposals: the flow is proved by backend integration tests, **not** by a live-stack journey, because the proposal tables have no grants for the local `gones_app` role.~~ **Resolved in T26.** `docker compose up -d postgres migrator permissions api` (with `GONES_FEATURES__ADMIN_V1=true`, `GONES_FEATURES__AUTH_V1=true`) does fix it: a full journey — register → verify → public organization list → org-scoped approvers → submit → mailed review link → approve → `Published` on `/api/tournaments/all` — runs green against the live stack. Re-run it to confirm; the grant gap this entry described no longer blocks anything, so the release note may be upgraded.

## T26 proposal-org-scoping

Two halves of one decision: **anyone may propose**, **only someone who represents the organization may
approve**. Check both halves, and check that neither ate the other.

### The submitter side — a stranger can propose

- [ ] Register a brand-new account, verify its email, and sign in. Do **not** add it to any organization. Go to `/tournaments/new`. The organization `<select>` must list **every** public organization, not an empty list. Before T26 this account saw zero options and the page was unusable for the one role it exists for.
- [ ] With that same zero-membership account, fill the form and click **Submit for approval**. The reviewer dialog opens, you pick someone, and you land on the "Request sent" panel. Confirm in the database that a `tournament_proposals` row exists and **no** `scheduled_tournaments` row was created.
- [ ] Watch the network tab while the page loads. It must call the anonymous `GET /api/organizations`, **not** `GET /api/users/me/organizations`. Those are different lists and the whole ticket turns on which one the picker reads.
- [ ] If your instance has more than 100 organizations: confirm the picker still lists all of them. The public endpoint pages at 100 and the component pulls every page — an organization must never become unproposable because its name sorts late.

### The approver side — the list is scoped

- [ ] Set up two organizations, A and B, with a different Organizer in each, plus one global Admin. As a plain user, start a proposal **for A** and open the reviewer dialog. It must show A's organizer and the global Admin, and must **not** show B's organizer. Repeat for B and confirm the mirror image.
- [ ] Confirm the dialog still shows only a username and a role chip. No email address may appear anywhere in the response — check the raw JSON, not just the rendering.
- [ ] Create an organization with no members at all and propose for it. The dialog must still be usable: global Admins are an unconditional fallback, so no organization can become unreachable.
- [ ] Try to route around the picker: `POST /api/tournament-proposals` by hand, naming B's organizer as the recipient on a proposal whose `organizationId` is A. Expect `400` with `recipientUserIds`, and confirm no proposal row and no queued mail. This is the security half — the client is not trusted to have used the scoped list.
- [ ] Send a `recipientUserIds` array of 11 entries. Expect `400`. Eleven is one over the cap; ten is allowed.

### The mailed link expires with the authority behind it

- [ ] Submit a proposal, take the review link from the reviewer's mail, and confirm it opens (`200`).
- [ ] Now remove that reviewer from the target organization (or demote them to `User`, or close their profile — check all three if you have time). Re-open the same link. It must return `404`, identically to an unknown token: it must not reveal that a proposal is sitting there. Confirm nothing was published.
- [ ] Confirm a **global Admin's** link on the same proposal still works after the organizer lost their membership. The Admin fallback must not be collateral damage.

### Approve and reject cannot both win

- [ ] Two reviewers on one proposal. Approve from the first link, then approve from the second: the second gets `409` and exactly **one** tournament exists.
- [ ] Approve from the first link, then reject from the second: `409`, the proposal stays `Approved`, and no rejection mail is queued.
- [ ] The one that used to break: reject from the second link *while* an approve is in flight. Whatever the outcome, a `Rejected` proposal must **never** leave a published, registerable tournament behind. Check `scheduled_tournaments` and `/api/tournaments/all`, not just the HTTP codes.

### Direct publishing is untouched

- [ ] Sign in as an **Organizer** and go to `/tournaments/new`. The picker must show only the organizations you belong to — **not** the full public list. Offering more would only earn a 403 at publish time.
- [ ] Complete a normal Organizer preview → publish. It must behave exactly as before T26. The publish path now shares a transaction when a proposal approval calls it; confirm the ordinary path is unaffected, including publishing two tournaments whose titles produce the same slug.

### The empty-picker dead click is gone

- [ ] Force an empty organization list (stop the API after login, or point at an instance with no organizations). The **Submit for approval** button must be **disabled**, and an explanatory message shown. Before T26 the button was clickable and silently did nothing, which is how the original defect hid.

## T27 review-gate-honesty

This ticket changed no shipped behaviour. One identifier moved and the rest is test and gate work, so
the manual pass is short: confirm the two things a human can see, and confirm the gates now bite.

### The one identifier that moved

- [ ] Sign in as an **Organizer**, go to `/tournaments/new`, complete a preview, then make the publish
      call fail with a 403 (stop your membership, or intercept `POST /api/tournaments`). The recovery
      panel must still offer a working **Reload organizations** button — it is now
      `data-cy="tournament-publish-error-reload"`, and clicking it must refresh the preview *and*
      reload the reference lists, not just one of them.
- [ ] Force the *form*-side 403 instead (fail `POST /api/tournaments/preview`). That panel's button is
      still `data-cy="reload-organizations"` and must only reload the references. The point of the
      rename is that these two are no longer the same name — if both panels ever appear with the same
      identifier again, `npm run test` fails on the duplicate.

### The sign-in affordance, which the spec now really checks

- [ ] Signed in, on `/`: there must be **no** link to `/login` anywhere on the page — not in the
      toolbar, not in the menu. Signed out, on `/`: there must be at least one.
- [ ] This is the assertion that was dead for the whole of T2→T26. If you add a sign-in link to the
      toolbar for a signed-in user, `cypress/e2e/auth-session-persistence.cy.js` must now go red.

### First visit

- [ ] In a browser profile that has never opened the app, load `/`. You must land on `/about`. Load `/`
      again: you must stay on `/`. This is `cypress/e2e/first-visit.cy.js`, which until T27 was executed
      by no committed gate at all — it now runs first in `npm run e2e:ci`.

### Migration safety (do this before any future entity rename)

- [ ] Before shipping a migration that renames a table, run `npm run backend:test` and confirm
      `MigrationSafetyTests` is green. It fails if an `Up` both drops and creates a table (EF's rename
      scaffold, which destroys every existing row) and if the model has changes no migration carries.
- [ ] The guard is a source check, not a data check. It does **not** prove a rename preserves rows on a
      populated database. If you rename a table that holds production data, still take a backup and still
      restore-test it — see `scripts/backup-restore-rehearsal.mjs`.

## T28 route-guard-assertions

This ticket changed no shipped behaviour and no route wiring — `app.routes.ts` ends byte-identical to
before. It only made six existing assertions in `src/app/data-mode-routes.test.ts` capable of failing
(they previously passed even when their guard was unwired, because `expect(undefined).toContain(fn)`
does not throw on vitest 4.1.10). No manual check applies.

- [ ] Nothing to click. If you want to sanity-check by hand anyway: temporarily remove `canActivate:
      [userGuard]` from the `settings/account` route in `src/app/app.routes.ts` and run `npm run test --
      data-mode-routes` — it must now fail on "guards the account route". Revert the change afterwards.

## T5 login-oauth-and-links-row

Automated coverage (`src/app/auth/auth-entry.layout.test.ts`) proves the label/logo order, the accessible
name wiring (`alt="Google"`/`alt="Facebook"`, no `aria-hidden`), the CSS rules (`.auth-links` keeps
`display: flex; justify-content: space-between`, the old `inline-block` override on `.oauth-grid +
.auth-links` is gone), and that the register page keeps its unchanged `auth.continueGoogle` /
`auth.continueFacebook` labels. It cannot prove rendered pixels, French runtime text, or a live
viewport — those need a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/login` — both OAuth buttons read "Continue with" then
      the logo, the two buttons are the same height, and the label/logo baselines line up.
- [ ] The Create account link sits flush left and Password forgotten flush right inside the card, at
      1440px and at 768px.
- [ ] At 360px the OAuth grid stacks to one column and the two links wrap without overlapping.
- [ ] Switch the app language to French: the buttons read "Continuer avec" then the logo.
- [ ] Open `/register`: its OAuth buttons are unchanged — still the full "Continue with Google" /
      "Continue with Facebook" text, logo first.

## T2 header-sign-in-entry

- [ ] `npm run dev`, open `http://127.0.0.1:4200/` signed out: the toolbar shows a "Sign in" action on the right (same slot the Log out button occupies when signed in), and the home menu grid has no sign-in card.
- [ ] Click that toolbar Sign in action: it navigates to `/login`.
- [ ] Sign in as `admin@gones.test` / `Gones-dev-pass-123!`: the toolbar Sign in action is replaced by the username link plus the red Log out button, in the same position.
- [ ] At a 400px viewport width, the toolbar still fits with no horizontal scroll and the Sign in / Log out slot stays right-aligned.
- [ ] Inspect the Sign in link's accessible name (screen reader or DevTools Accessibility pane): it reads "Sign in or create an account" (English) / "Se connecter ou créer un compte" (French).

## T1 dev-accounts-and-refresh-cookie

Only the browser half is left here. The API half was proved automatically against the live stack:
`POST /api/auth/login` for `admin@gones.test` answered `200` (it answered `401` before this slice),
the response carried `Set-Cookie: gones_refresh=…; path=/api/auth; samesite=lax; httponly` with **no**
`secure` attribute, `POST /api/auth/refresh` with that cookie answered `200`, and a second
`npm run dev:accounts` exited `0` while leaving exactly the two rows in place. What a curl transcript
cannot model is a browser's own refusal to store a `Secure` cookie over plain http, and no rendered UI.

- [ ] `docker compose down -v && npm run dev` from a clean checkout: the run prints
      `Seeded dev accounts: admin@gones.test (Admin), test@gones.test (User).` before `ng serve` starts.
- [ ] At `http://127.0.0.1:4200/login`, sign in as `admin@gones.test` / `Gones-dev-pass-123!` — no 401,
      and the toolbar shows the username.
- [ ] Reload the page — still signed in. DevTools → Application → Cookies → `http://127.0.0.1:5080`:
      `gones_refresh` is present, `SameSite` is `Lax`, and the **Secure** column is unticked.
- [ ] Sign out, then sign in as `test@gones.test` / `Gones-dev-pass-123!` — it succeeds and no
      admin-only navigation (the Admin dashboard entry) is offered.
- [ ] `npm run dev -- --no-accounts` starts the stack and the dev server without running the seeder
      (no `Seeded dev accounts:` line), and `--no-accounts` is not forwarded to `ng serve`.

## T3 home-last-card-row-rule

- [ ] `npm run dev`, open `http://127.0.0.1:4200/` at 1440px **signed out**: 5 cards render, About sits alone on the last row and spans the full row width.
- [ ] Sign in as `admin@gones.test`: 6 cards render, the last row holds My registrations/Settings/About laid out two-per-row, each half width, none stretched full-row.
- [ ] Shrink the viewport to 480px: every card is full width, no horizontal overflow, and no visible gap artefact where the old `.home-destination--about { grid-column: auto; }` override used to sit.

## T4 delete-live-tournament

The delete path itself is automated (`cypress/e2e/live-local.cy.js` covers create → advanced settings →
delete → cancel, then delete → confirm → empty list → reload still empty, on the browser-local store).
Two things it cannot prove: how the button *looks*, because every Material dialog reports `opacity: 0`
under headless Electron so Cypress can never assert dialog visibility, and the **server** adapter path,
which no automated spec in this slice signs in for.

- [ ] `npm run dev`, signed out, `/live-tournaments` → create a tournament → toolbar **Advanced settings**: a Delete button sits at the **bottom** of the dialog, below Cancel/Apply and separated from them by a hairline rule — red outline, red label, transparent fill (a ghost button, not a filled one).
- [ ] Click it: the settings dialog closes and a confirmation dialog appears naming the tournament, with the destructive (red) confirm button. Press **Cancel** — you are back on the runner and the tournament is untouched.
- [ ] Repeat and **confirm**: you land on `/live-tournaments`, which shows the empty state. Reload the page: the tournament is still gone (its IndexedDB row was deleted, ADR 0021).
- [ ] Switch the app language to French and repeat the open/cancel path: the button reads "Supprimer ce tournoi", the dialog title "Supprimer ce tournoi en cours ?" and the message names the tournament — no missing-key placeholders.
- [ ] Sign in as `admin@gones.test` / `Gones-dev-pass-123!` (server adapter), create a running tournament, then delete it the same way: it disappears from the Live Tournament list and a second reload does not bring it back. Watch the Network tab — the `DELETE /api/live-tournaments/{id}` request carries an `If-Match` header.
- [ ] Still signed in as Admin, open the same running tournament in two tabs. Change something in tab A, then delete from tab B's advanced settings: if the delete is refused as stale, the runner stays put and shows "The tournament changed elsewhere. Reload the page and try again." — no half-deleted state.
- [ ] Sign in as `test@gones.test` (plain `User`, browser-local store per ADR 0021): they only ever see their own local tournaments, and the Delete button is present for those. A visitor who cannot manage a tournament (read-only runner) must see **no** Delete button at the bottom of the advanced settings.

## T6 login-validation-gate

Automated coverage (`src/app/auth/login-validation.test.ts`) proves the two pure validators (email shape,
3-character password, trimming), that the login submit line carries `[disabled]="!loginValid()"` and
`[class.auth-submit--ready]="loginValid()"`, that `.auth-submit--ready` is filled `--create-green` and
`.auth-submit--idle` / `:disabled` is `--steel` / `--dim-ash`, and that both validity messages exist
(`login-email-validity`, `login-password-validity`). `cypress/e2e/auth-profile.cy.js` proves a real login
still reaches `/settings/account` through the gate. What none of it proves: rendered colour, the moment a
message appears while typing, and the French runtime strings — those need a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/login` with both fields empty: the Sign in button is grey
      and disabled, and neither validity message is shown.
- [ ] Type `admin` in the email: "Enter a valid email address." appears under the email field and the
      button stays grey and disabled.
- [ ] Complete the address to `admin@gones.test` (message clears) and type `ab` in the password:
      "Enter at least 3 characters." appears and the button is still disabled.
- [ ] Extend the password to `Gones-dev-pass-123!`: both messages are gone, the button turns green and
      enabled, and clicking it signs you in.
- [ ] While the request is in flight the button label reads "Signing in…" and the whole fieldset is
      disabled — the green state must not let a second submit through.
- [ ] Switch the app language to French and repeat: the two messages read "Saisissez une adresse e-mail
      valide." and "Saisissez au moins 3 caractères." with no missing-key placeholders.
- [ ] Open `/register`, `/forgot-password` and `/reset-password`: their submit buttons are unchanged —
      still the plain red primary action, enabled from the start, with no client validity messages.
- [ ] Sign in with an account whose password is shorter than the server's 12-character registration
      policy (a legacy account, if one exists): the 3-character client gate must let it through — the
      login form deliberately does not mirror the server policy (assumption A8).

## T7 calendar-sync-action-row

Automated coverage: `public-calendar.component.test.ts` proves the top row's source-level layout contract
(back button + sync group share `calendar-top-actions`, stamp precedes the button, the icon is inline SVG
with `aria-hidden="true"`, the header keeps the Create action, `.calendar-top-actions`
is `display: flex; justify-content: space-between`). `cypress/e2e/public-calendar.cy.js`'s "Synchroniser
forces a refetch" case clicks `[data-cy="calendar-sync"]` and asserts `[data-cy="calendar-synced-at"]`
becomes visible afterwards. None of that proves rendered pixel position, responsive wrap, or offline
rendering — those need a human. (T8 note: the view tabs moved out of `calendar-header-actions` onto
their own row below the search input — the line above no longer claims the header keeps them; see the
T8 section below for that row's own manual checks.)

- [ ] `npm run dev`, open `http://127.0.0.1:4200/calendar`: the back-to-menu button sits on the left of the
      top row, the Synchronise button with its circular-arrows icon is on the right, and the "last
      synchronised" text sits immediately to its left of the button.
- [ ] Clear the cached catalogue (the `localStorage` key used by `all-tournaments-cache.service.ts`) and
      reload: with no `syncedAt` yet, the stamp is absent and the Synchronise button is still flush right.
- [ ] Resize to 480px wide: the sync group wraps under the back button without horizontal overflow.
- [ ] Throttle the network to offline (or block `fonts.googleapis.com`) and reload: the sync icon still
      renders, because it is inline SVG and not a Material Icons webfont glyph.

## T8 calendar-search-row

Automated coverage: `public-calendar.component.test.ts` proves the source-level layout contract (search
row sits between `calendar-title` and `calendar-view-tabs`, no visible `<label>`, the input carries
`[attr.aria-label]="i18n.t('common.search')"`, the search row's `<form>` tag has neither `panel` nor
`calendar-filter-form` in its class list, `.calendar-search-input` has `border: 0` / `background:
transparent` and no `min-height: 48px`, `.calendar-search-input:focus-visible` still sets an `outline`,
and `calendar-view-tabs` is no longer inside `calendar-header-actions`) plus two behavioural cases proving
the same `filterTournaments` pipeline drives both `items()` and `groups()`. `cypress/e2e/accessibility.cy.js`'s
"every calendar filter control has a programmatic name" now runs against `[data-cy="calendar-search-row"]`
and passes headless. None of that proves rendered pixel layout, wrap behaviour, or the debounced URL write
in a real browser — those need a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/calendar`: the search input sits directly under the page
      title, spans the full content width, has no visible border or background box, and the Calendar /
      List buttons are on the row below it.
- [ ] Type a venue city into the search input: the list tab drops non-matching tournaments as you type,
      and the URL gains `?q=…` about 300 ms after you stop typing.
- [ ] Tab (keyboard) into the search input: a red focus ring is visible around it.
- [ ] Resize to 480px wide: the search row still spans the width and the Calendar / List buttons wrap
      onto their own line under it.

## T9 month-nav-above-grid

Automated coverage: `public-calendar.component.test.ts` proves the source-level layout contract (the
`calendar-month-controls` nav is the element immediately above `.public-month-grid`, with no other
`data-cy` element between them; `.calendar-month-controls` is `display: flex; width: 100%;
justify-content: space-between`; `.calendar-month-controls h2` is `flex: 1; text-align: center`; no
`.calendar-month-controls` rule declares `grid-column` or `justify-self` anywhere in the stylesheet)
plus behavioural cases (`moveMonth(1)` navigates with `month` advanced and `view` still `'calendar'`,
and `shiftMonth('2026-01', -1)` returns `'2025-12'`). `cypress/e2e/public-calendar.cy.js`'s "navigates
months over the cached catalog without re-querying the API" clicks `[data-cy="calendar-month-next"]`
then `[data-cy="calendar-month-prev"]` and asserts the month label and catalogue state. None of that
proves rendered pixel position or responsive wrap — those need a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/calendar` in calendar view at 1440px wide: Previous is
      flush to the left edge of the row, the month name is centred, Next is flush to the right edge, and
      the row sits directly on top of the seven-column month grid with no gap or overlap.
- [ ] Switch to the List tab: the month nav row disappears entirely (it only renders in calendar view).
- [ ] Resize to 480px wide while in calendar view: Previous / month label / Next stay on one row, edge to
      edge, with no wrapping or horizontal overflow.

## T10 empty-calendar-day-cells

Automated coverage: `public-calendar.component.test.ts` proves the source-level contract (no
`calendar-pill` anywhere in the component or in `src/styles.css`, `data-cy="calendar-month-day"`
still contains `data-cy="calendar-month-day-date"`, `interface MonthDay` no longer declares `items`,
`buildMonthDays(month: string)` takes one argument) plus behavioural cases (`monthDays()` is still 42
cells / `monthWeeks()` still 6 rows of 7, in-month flags and the first day of the month survive,
`items()` still empties on a non-matching search, `groups()` still groups tournaments by date for the
list view). `cypress/e2e/public-calendar.cy.js` and `cypress/e2e/accessibility.cy.js` render the real
grid in headless Electron and pass with the tournament pill markup gone. None of that proves rendered
pixel appearance in a real browser — that needs a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/calendar` in calendar view for a month with
      tournaments — every day cell shows only its day number; no tournament titles, times, status
      badges or links appear anywhere inside the grid.
- [ ] Switch to the List tab — the grouped tournament cards are all still there, each still links to
      its detail page.
- [ ] Type a nonsense search query while on the calendar tab — the empty-state panel appears under the
      grid (this is now the calendar tab's only filter-driven signal).
- [ ] Navigate months with Previous / Next — the grid re-renders with the correct day numbers and the
      correct muted leading/trailing days, still with no tournament content in any cell.
