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
- [ ] Restore that same downloaded bundle through the restore screen: it is accepted and creates a new League. A bundle exported _before_ this change must also still restore.
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
- [ ] Export a League from the archive detail page, then restore that same file through the header Import control: the League comes back complete (tournaments, rounds, entries, standings). A bundle exported _before_ this rename must also restore — the bundle format is frozen and its JSON must still say `"kind": "league"`.
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
- [ ] Go offline _first_, then navigate to `/calendar` in a tab that has visited it before: the app boots from the service worker cache, the cached tournaments render, and the same offline banner is shown. This is the affordance the failing spec claimed had been lost — it has not.
- [ ] While offline on a tournament page, try to register: the write is refused with "Nothing was queued or changed" and no request leaves the browser (DevTools → Network shows none).
- [ ] Run `npm run e2e:ci` on a clean checkout and confirm `auth-session-persistence.cy.js` now appears in the run output — the gate had been silently skipping it, and running it is what uncovered the sixth failure.
- [ ] Before hand-running `cypress/e2e/auth-profile.cy.js` on its own, re-run `node scripts/seed-auth-e2e.mjs`: that spec mutates the shared seeded account (it publishes the location), so a stale account makes its first assertion fail for reasons unrelated to the code under test.

## T25 data-cy-sweep-and-matrix

This ticket changed **identifiers only** — 24 component files gained `data-cy` attributes and not one
line of markup structure, styling or logic moved. The automated proof is that the set of `data-cy`
values in `src/app` went from 1079 to 1891 with **zero removed and zero changed**, and that
`npm run e2e:ci` stayed at 18/18. So the point of this list is _not_ to re-test features: it is to
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
- [ ] The one that used to break: reject from the second link _while_ an approve is in flight. Whatever the outcome, a `Rejected` proposal must **never** leave a published, registerable tournament behind. Check `scheduled_tournaments` and `/api/tournaments/all`, not just the HTTP codes.

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
      `data-cy="tournament-publish-error-reload"`, and clicking it must refresh the preview _and_
      reload the reference lists, not just one of them.
- [ ] Force the _form_-side 403 instead (fail `POST /api/tournaments/preview`). That panel's button is
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

**Superseded by T9 oauth-button-alignment (below):** the register page no longer keeps its own
`auth.continueGoogle` / `auth.continueFacebook` labels with logo-first order, and the login `<img>`
alt text is no longer the literal `alt="Google"` / `alt="Facebook"`. See the T9 section for the
current shape of both OAuth blocks; the two bullets below that described the old register/alt
behaviour are removed. The links-row bullets below (Create account / Password forgotten placement,
narrow-viewport stacking) are unaffected and still apply.

Automated coverage (`src/app/auth/auth-entry.layout.test.ts`) proves the label/logo order, the
accessible-name wiring, and the CSS rules (`.auth-links` keeps `display: flex; justify-content:
space-between`, the old `inline-block` override on `.oauth-grid + .auth-links` is gone). It cannot
prove rendered pixels, French runtime text, or a live viewport — those need a human:

- [ ] The Create account link sits flush left and Password forgotten flush right inside the card, at
      1440px and at 768px.
- [ ] At 360px the OAuth grid stacks to one column and the two links wrap without overlapping.

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
Two things it cannot prove: how the button _looks_, because every Material dialog reports `opacity: 0`
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

## T11 list-view-pagination

Automated coverage: `public-calendar.test.ts` proves the pure helpers (`calendarPageCount`,
`clampCalendarPage`, `paginateTournaments`, `sortTournamentsForList`) and the `page` query-parameter
parsing/serialising (missing/junk defaults to `1`, page `1` is omitted from the URL, later pages are
written). `public-calendar.component.test.ts` proves `pagedItems()`/`pageCount()`/`currentPage()` slice
correctly, `movePage()` navigates with the `page` param, and search/month/view changes all reset `page`
to `1`. `cypress/e2e/public-calendar.cy.js` stubs a 25-tournament catalogue and asserts 20 cards + the
pagination row on page 1, 5 cards on `?page=2` after clicking Next, and that typing in search drops
`page` from the URL. None of that proves rendered layout or a genuinely large real catalogue in a
browser — that needs a human:

- [ ] `npm run dev` with more than 20 published tournaments in the catalogue, open
      `/calendar?view=list` — exactly 20 cards render and a pagination row (Previous / "Page 1 of N" /
      Next) appears below the list; click Next and the URL gains `?page=2` with the next batch of cards.
- [ ] With 20 or fewer tournaments in the catalogue, open the List tab — no pagination row renders at
      all.
- [ ] On page 2 (or later), type into the search box — the URL loses `page` and the list restarts at
      the first page of matching results.
- [ ] Hand-edit the URL to `?view=list&page=99` — the last page of results renders (not an empty list),
      and the pagination status reflects the clamped page number.
- [ ] Switch from the List tab to the Calendar tab while on a page other than 1 — the pagination row
      disappears and `page` is not present in the URL.

## T12 local-league-store-core

Automated coverage: `src/app/data/league-archive-origin.test.ts` (7 cases) pins the ADR 0028 id-prefix
routing rule, and `src/app/backend/local-league-archive-backend.service.test.ts` (20 cases) drives
`LocalLeagueArchiveBackend` against an in-memory IndexedDB fake — placeholder seeding, local ids,
name trimming, version-guarded rename/status/delete, `staleLeagueDocument` (412) refusals leaving the
document untouched, `updatedAt` stamping, placeholder-first sorting, and restore rewriting incoming
ids into the `local-` namespace. `server-authority-boundary.test.ts` holds the three-file IndexedDB
allowlist. The ticket's own manual line (nothing changed yet) was proved automatically: the built
bundle contains no `gones-leagues` string and no `LocalLeagueArchiveBackend`, so nothing can open the
database. None of that is a real browser against a real IndexedDB — that needs a human:

**Superseded by T14.** T14 injects `LocalLeagueArchiveBackend` into `LeagueArchiveRepository`, so the
three steps below are false from that commit onward: the League pages _do_ change signed out, and a
`gones-leagues` database _does_ appear. They are kept for the record and must not be run against a
build at T14 or later — use the T14 section instead.

- [ ] ~~`npm run dev`, open `http://127.0.0.1:4200`, browse Leagues and the archive league page signed
      out and signed in — behaviour is identical to before this commit; no new option, badge or error
      appears anywhere.~~ (stale at T14: the local notice, the create card and the local badge are
      expected signed out.)
- [ ] ~~DevTools → Application → IndexedDB — only `gones-live` is listed; no `gones-leagues` database
      exists after browsing every page.~~ (stale at T14: `gones-leagues` is created on the first visit
      to `/leagues-archive`.)
- [ ] ~~DevTools → Network — no request fails and no new request appears that was not there before.~~
      (stale at T14: a signed-out visitor's `/api/leagues-archive` read is expected to fail and is
      surfaced as the server-unavailable notice, not as an error.)

## T13 local-league-store-parity

Automated coverage: `src/app/backend/local-league-archive-backend.service.test.ts` grew to 44 cases —
every one of the 13 newly implemented `LeagueArchiveBackendPort` methods (tournament create/edit/
delete/move, round add/delete/replace/import, entry add/edit/delete, player archetype upsert, league
player rename), the exactly-one-version-bump rule per command, a stale-version refusal per command
leaving the stored document identical, both stale sides of a two-document move, the
`crossAuthorityMoveNotSupported` refusal for a server target, and a move into the local placeholder.
`npm run typecheck` is the parity gate: the class now declares `implements LeagueArchiveBackendPort`
with no `Partial`, so a missing or mis-typed method cannot compile. The ticket's manual line is again
a negative check and was proved by build-and-grep instead of a browser: after `npm run build`,
`grep -ro 'gones-leagues' dist/gones | wc -l` returns `0` and nothing outside the service and its own
test names `LocalLeagueArchiveBackend`, so the adapter is tree-shaken out and no browser session can
open the database. A human still owns the real-browser confirmation:

**Superseded by T14**, for the same reason as the T12 steps above: T14 is the commit that wires the
adapter in, so `LocalLeagueArchiveBackend` is no longer tree-shaken out and the database is no longer
absent. Kept for the record; do not run them against a build at T14 or later.

- [ ] ~~`npm run dev`, open `http://127.0.0.1:4200`, browse Leagues, an archive league and a tournament
      detail page signed out and signed in — behaviour is identical to before this commit; no new
      option, badge or error appears anywhere.~~ (stale at T14.)
- [ ] ~~DevTools → Application → IndexedDB — only `gones-live` is listed; no `gones-leagues` database
      exists after browsing every page.~~ (stale at T14: the database is created on the first visit to
      `/leagues-archive`.)
- [ ] ~~DevTools → Network — no request fails and no new request appears that was not there before.~~
      (stale at T14: the signed-out `/api/leagues-archive` read is expected to fail.)

## T14 dual-source-league-list

Automated coverage: `src/app/data/league-archive-routing.test.ts` (5 cases) pins `canManageLeague`
and `createLeagueTarget`; `src/app/data/league-archive-repository.service.test.ts` (48 cases) drives
`LeagueArchiveRepository` against two hand-written fakes — the merged list, the degrade-to-local path
and its `serverUnavailable` flag, both-stores-failing propagation, the placeholder resolving per
authority, all 17 routed methods (each asserted to leave the _other_ store untouched), and both
directions of the refused cross-store move; `league-archive-list.component.test.ts` (6 cases) pins the
template shape. `cypress/e2e/league-local.cy.js` (4 tests) drives the real browser: the whole
signed-out create → tournament → round → entry → reload flow with every `/api/leagues-archive`
request asserted answered `401`, a direct read of the `gones-leagues` object store, the merged list
for a stubbed Admin and a stubbed plain `User`, and the cross-authority move refusal with its rendered
message. `cypress/e2e/league-server.cy.js` still passes unchanged, including its `User` read-only case.

What that leaves for a human — the parts a stubbed session cannot prove:

- [ ] `npm run dev`, sign in as `admin@gones.test` against the **real** API (not a stubbed profile) —
      the list shows the seeded server leagues and any league created in this browser while signed
      out, the local ones badged `Local only`; renaming a server league still writes the server
      (Network shows the `PATCH`), renaming a local one makes no request at all.
- [ ] Same, as `test@gones.test` — server rows are read-only and the read-only notice is shown, while
      a league created in this browser stays fully editable in the same list.
- [ ] Signed out with the API stack **stopped** (`docker compose stop api`) — `/leagues-archive` still
      loads, shows the server-unavailable notice, and every local write keeps working.
- [ ] Visual check of the `Local only` badge on a narrow viewport (≤ 480 px) — it does not collide
      with the status pill in the opposite corner of the card.
- [ ] Clear site data, reload — the local leagues are gone and nothing errors, which is the documented
      ADR 0028 consequence rather than a bug.

## T15 dual-source-export-import

Automated coverage: `src/app/app.component.export.test.ts` (7 cases) drives `AppComponent` over a
fake repository — the full export carries a league from each store, drops the server placeholder,
drops the local placeholder (the defect this slice fixes), drops a placeholder that holds tournaments,
keeps `gones-full-data.gones.json` and a checksum that `verifyExportChecksum` accepts, exports a
single browser-local league under `leagueExportFilename`, and asserts the header import button is no
longer inside a role gate. `src/app/data/league-archive-import.service.test.ts` (6 cases) runs the
real `LeagueArchiveImportService` over the real `LeagueArchiveRepository` and two fake backends: an
anonymous visitor and a plain `User` land a `fullData` bundle in the browser store with `local-` ids
and the server never asked, an `Organizer` lands it on the server with the browser never asked, the
single-league path follows the same authority for an anonymous visitor and for an `Admin`, and a
rejected import leaves both stores untouched. `cypress/e2e/league-local.cy.js` gained
`exports both browser leagues and imports them back into an emptied browser`: two signed-out local
leagues with a tournament each, the exported bundle captured through `URL.createObjectURL` and
asserted to hold both names, only `local-` ids and no placeholder, both leagues deleted, the same file
re-imported through `header-import-input`, both leagues back and badged local with their tournaments
intact, every `/api/leagues-archive` call answered `401`.

Covered by the automation above, so **not** re-run by hand:

- [x] Signed out: create two local leagues, Full data export, open the file — both leagues are in it,
      neither placeholder is. (Proved by the Cypress round trip and by the four export cases.)
- [x] Signed out: delete both, import the file back — both return, badged local, with their
      tournaments intact. (Proved by the same Cypress test, including the `gones-leagues` row check.)

What that leaves for a human — the parts a stubbed or signed-out session cannot prove:

- [ ] `npm run dev`, sign in as `admin@gones.test` against the **real** API, with at least one league
      created in this browser while signed out — Full data export, open the file: it holds the server
      leagues **and** the browser-local ones, and neither placeholder. (Automation proves the merged
      list and the placeholder filter separately; nothing automated clicks export as a real Admin.)
- [ ] Same session: import that bundle back — Network shows the restore going to
      `POST /api/leagues-archive/...` (never to IndexedDB), and the restored leagues are visible from
      a **different** browser profile, which is the only proof they really landed on the server.
- [ ] Signed out, with a bundle exported by an Admin: import it — the leagues appear badged
      `Local only` with fresh `local-` ids and no request leaves the browser.

**Corrected by T16.** A local restore is now additive: every imported league is written under a
freshly minted `local-` id and its name is uniquified, exactly like the server's restore. So the two
round-trip steps above only read as written because they _delete_ the leagues first. Do not expect a
re-imported league to carry the id it had before the export (it never will), and if you import a
bundle **without** deleting first you will get a second copy named `… (restored)` rather than the
original row being replaced — that is the fix, not a bug.

## T16 reviewer-correctness-fixes

Three data-integrity fixes from the reviewer fanout. Automated coverage:
`src/app/backend/local-league-archive-backend.service.test.ts` (46 cases) proves a restore never
targets an existing row or either placeholder and that the same bundle restored twice yields two
leagues; `src/app/app.component.export.test.ts` (9 cases) proves the full export refuses to write
while `serverUnavailable()` is set and still writes when it is not;
`src/app/features/live-tournaments/live-tournament-league-picker.test.ts` proves the Live picker
offers server leagues only. What no unit test can show is the thing that matters most here — that a
real import against a real IndexedDB leaves a real league alone. Run these in a real browser.

### An import can no longer destroy a league (the one to see with your own eyes)

- [ ] `npm run dev`, signed out, `/leagues-archive`: create a league `Summer`, open it, add a
      tournament, and note its URL id (`/leagues-archive/local-…`).
- [ ] Full data export while `Summer` holds exactly that one tournament. Keep the file.
- [ ] Back in `Summer`, add a second tournament and rename the league to `Summer edited`.
- [ ] Import the file you kept. The list now shows **both** `Summer edited` (still with its two
      tournaments, still at the id you noted) **and** a second league `Summer` holding the one
      tournament the file carried, badged `Local only` with a different `local-` id. Nothing you did
      after the export was lost. Before this fix the edited league was silently replaced by the
      one-tournament snapshot.
- [ ] Import the same file a second time: a third league appears, named `Summer (restored)`. Import
      once more: `Summer (restored) 2`. No import ever overwrites an earlier one.
- [ ] DevTools → Application → IndexedDB → `gones-leagues` → `leagues`: every row has a distinct
      `local-` id and the `local-placeholder-league` row is untouched by all of it.
- [ ] Hand-edit a copy of the exported file so one league's `"id"` reads `"local-placeholder-league"`
      (the checksum will no longer match, so also delete the `"checksum"` property, or re-export
      after the edit if your build rejects it). Import it: the browser's own "Unassigned Tournaments"
      row keeps its own tournaments and the file's content lands as an ordinary new local league.
      Repeat with `"id": "placeholder-league"` — same outcome.
- [ ] Repeat the first bullet's edit-then-import cycle for a **single-league** export (the per-league
      export from a league's own menu), not just the full export: it is the same restore path.

### A partial export is refused, not written

- [ ] Signed in as `admin@gones.test` with the API stack **stopped** (`docker compose stop api`),
      open `/leagues-archive` and click Full data export: **no file is downloaded**, and the red
      banner under the toolbar says the server leagues could not be loaded so nothing was written.
      Check the Downloads folder — before this fix you got a `gones-full-data.gones.json` holding
      only the browser's leagues, presented as a complete backup.
- [ ] Switch the app language to French and repeat: the message reads in French with no missing-key
      placeholder.
- [ ] Start the API again (`docker compose start api`), reload, and export: the file downloads as
      before, holds the server leagues **and** the browser-local ones, and the banner is gone.
- [ ] Signed **out**, with the API stack stopped or running (the server read always fails for an
      anonymous visitor either way): Full data export still **downloads** a file holding the browser's
      leagues, with no banner. This is deliberate and is the behaviour to protect — a signed-out
      visitor has no server leagues, so their bundle is complete, and refusing here would take away
      the only backup ADR 0028 gives them. If a future change makes this path refuse, that is a
      regression, not a tightening.
- [ ] Sign in, then let the session expire (or clear the stored profile) so the toolbar shows you as
      signed out again, and export: the file is written browser-only. Known and accepted — the bundle
      matches what that visitor can actually see.

### The Live League picker offers only server leagues

- [ ] Signed in as `admin@gones.test`, with at least one league created in this browser while signed
      out, open a running tournament at `/live-tournaments/{id}` → the League field: it lists the
      unassigned option plus the **server** leagues only. No second "Unassigned Tournaments" entry,
      and no browser-local league. Before this fix, picking one produced a failed save and the choice
      was silently discarded.
- [ ] Pick a server league and finalize: the tournament lands in that League Archive exactly as
      before.

## T17 e2e-gate-and-test-honesty

Test-only ticket: no product file changed. Three committed Cypress specs were red inside this plan's
own commit range, and four vitest assertions passed while the behaviour under them was broken. Both
halves are now covered automatically — `npm run cy:run` (85/85), `npm run e2e:ci` (20/20 release
specs) and `npm run test` (774 cases) are green, and each of the four gaps was proved red against a
deliberately broken implementation before being restored. There is nothing new to click; the items
below only exist to confirm by eye that the _replacement_ assertions describe what the app really
does, because a test that asserts the wrong thing is exactly the failure this ticket is about.

### The month grid really moves (the assertion R1 now makes)

- [ ] `npm run dev`, `/calendar?month=2026-08&view=calendar`, language **French**: the month label
      reads `août 2026` — this is why the spec must not assert `August`.
- [ ] Inspect any day cell: `<time datetime="2026-08-15">` — the `datetime` attribute stays the ISO
      date in both languages. Switch to English and re-inspect: label changes, `datetime` does not.
- [ ] Click Next: the grid holds a cell with `datetime="2026-09-15"` and none with `2026-08-15`.
      Click Previous: the reverse. Only one `/api/tournaments/all` request for the whole sequence.

### An anonymous visitor is still offered a way in (the assertion R2 now makes)

- [ ] Signed out, home page: the toolbar shows the **Sign in** button (`toolbar-sign-in-link`). The
      old home-menu login card is gone for good and must not come back.
- [ ] Sign in: the button is replaced by the username link, and no link to `/login` is left anywhere
      on the page.

### Deleting a local tournament (the assertion R3 now makes)

- [ ] Signed out, `/live-tournaments`: create two tournaments, `Keep me` and `Doomed Cup`. Delete
      `Doomed Cup` from Advanced settings → Delete → Confirm.
- [ ] The list keeps `Keep me` and no longer shows `Doomed Cup`, before and after a reload. The spec
      asserts exactly this (the deleted row is gone), not that the list is empty — the empty state is
      asserted by the first case, which runs in a browser that has never opened the store.

### Spot-checks for the four closed gaps

- [ ] `/login` with both fields empty: the Sign in button is grey and disabled, and **no** validity
      message is shown under either field.
- [ ] Type `admin@gones.test` and `ab`: still disabled, and only the password message appears. Add a
      third character: the button turns green.
- [ ] A calendar list with 20 or fewer tournaments shows **no** pagination bar at all — not a bar
      with two disabled buttons.
- [ ] `/leagues-archive` signed in as `admin@gones.test` with at least one browser-local league: the
      local row carries the badge and the server rows carry none.

## T1 dev-environment-loader

The loader itself is covered by `ops/dev-environments.test.ts` and the seeding run is proved by
`node scripts/seed-dev-environment.mjs --env=minimal` (three rows in `asp_net_users`, all three
accounts answering 200 on `POST /api/auth/login`). What no automated test covers is what the three
roles actually see in the browser, and that plain `npm run dev` still feels exactly as it did.

- [ ] `npm run dev -- --env=minimal` from a stopped stack: the local database is wiped and rebuilt,
      the seeder prints the three accounts with `Gones-dev-pass-123!`, and the dev server then comes
      up on `http://127.0.0.1:4200` — the reset must not leave anything holding port 4200.
- [ ] Sign in as `organizer@gones.test`: the Organizer actions are present in the header, and the
      organizer pages open.
- [ ] Sign in as `admin@gones.test`: the Admin dashboard opens (`/admin/users`).
- [ ] Sign in as `test@gones.test`: neither the Organizer actions nor the Admin dashboard are
      reachable — the plain `User` role is what the fixture asked for.
- [ ] All three sign in without any "confirm your email" wall: the fixture's `emailConfirmed` default
      really was applied.
- [ ] The Calendar, the League Archive and the Live pages are empty for all three roles: `minimal`
      ships accounts and nothing else.
- [ ] Stop the stack (`docker compose down`), then plain `npm run dev`: no reset runs, no environment
      is seeded, and the app behaves exactly as it did before this change (the two ADR 0029 accounts,
      empty screens).
- [ ] `npm run dev -- --env=minimal --no-docker` is refused with `--env needs the Docker stack; drop
      --no-docker.` and starts nothing.
- [ ] `npm run dev -- --env=typo` stops with `Unknown environment "typo". Available: empty, minimal`
      and leaves the database untouched — a typo must not cost you your data.
- [ ] Edit `fixtures/dev-environments/minimal/accounts.json` (change a first name), re-run
      `npm run dev -- --env=minimal`: the change is live with no rebuild of anything.

## T2 demo-calendar-dataset

The dataset itself is proved by `node scripts/seed-dev-environment.mjs --env=demo` (exit 0, then 2
organizations / 4 formats / 9 tournaments / 12 confirmed registrations in the database, the offset-0
tournament `InProgress` and the four past ones `Completed`), and the fixture cross-references are
covered by `ops/dev-environments.test.ts`. What no automated check covers is how the seeded calendar
reads in the browser.

- [ ] `npm run dev -- --env=demo`, then open `/calendar` signed out: tournaments appear in past,
      current and future months, and the one starting today reads as ongoing, not upcoming.
- [ ] Still signed out, open the today tournament's detail page: venue, city, formats and the
      organizing club are all filled in, and the body text renders as formatted HTML.
- [ ] Sign in as `organizer@gones.test` and open `/organizer/tournaments`: exactly the five Gones
      Lyon tournaments are listed, and none of the four Ligue AURA ones.
- [ ] Open the participants screen of the Commander social evening: three registrants are listed
      (`gones-test`, `gones-player-1`, `gones-player-2`), and the capacity reads as unlimited.
- [ ] Sign in as `test@gones.test` and open `/registrations`: the four future tournaments it is
      registered to are listed, and cancelling one removes it from the organizer participants screen.
- [ ] Sign in as `unverified@gones.test`: registering for any tournament is refused with the
      verify-your-email message - that account exists to make that state clickable.
- [ ] Sign in as `organizer2@gones.test`: it sees the four Ligue AURA tournaments and cannot touch the
      Gones Lyon ones.
- [ ] Edit a title in `fixtures/dev-environments/demo/tournaments.json`, re-run
      `npm run dev -- --env=demo`: the new title is live, and the dataset is not stacked twice.
- [ ] `npm run dev -- --env=minimal` after a `demo` run: the calendar is empty again - the reset
      really dropped the previous dataset.

## T3 demo-league-and-live-dataset

The data itself is proved by `node scripts/seed-dev-environment.mjs --env=demo` (exit 0, twice in a
row, then `Gones League 6` completed with 3 Archive Tournaments / 3 Rounds each / 30 League Result
rows, `Gones League 7` active, `Gones League 7 - Day 2` on stage `round` with an unscored open Round
and `Lyon Legacy Weekly` on stage `standings`), and the fixture shapes are covered by
`ops/dev-environments.test.ts`. What no automated check covers is how the archive and the running
tournaments read in the browser.

- [ ] `npm run dev -- --env=demo`, then open `/leagues-archive` signed out: `Gones League 6`
      (completed) and `Gones League 7` (active) are both listed next to the browser-local ones.
- [ ] Open `Gones League 6`: three Archive Tournaments (`Day 1`, `Day 2`, `Day 3`, February 2026
      dates - the archive is history, so its dates do not roll), and the League Result table lists
      about thirty synthetic Demo Player names with non-trivial points.
- [ ] Open `Day 3` and scroll to Round 3: the last Round Entry is a Bye for `Demo Player 27`,
      and it reads as a win in the Tournament Result.
- [ ] Click a Player Name (`Demo Player 01`): Player Statistics open with Matches across the three
      Archive Tournaments, and the Deck Archetype column shows preset names such as `Delver (Izzet)`.
- [ ] Sign in as `organizer@gones.test` and open `/live-tournaments`: `Gones League 7 - Day 2` is
      there, Round 2 is open with four empty score fields, and Round 1 is validated.
- [ ] Enter the four scores of that open Round and validate it: standings advance, nothing else in
      the dataset moves.
- [ ] Sign in as `organizer2@gones.test` and open `Lyon Legacy Weekly`: it sits at standings after
      three validated Rounds, has no League assigned, and the paid column is off.
- [ ] Sign out entirely: `/live-tournaments` shows the browser-local store (ADR 0021), not these two
      server-side ones - a plain visitor never sees an Organizer's running tournament.
- [ ] Edit a Player Name in `fixtures/dev-environments/demo/leagues.json`, re-run
      `npm run dev -- --env=demo`: the new name is live, and there is still exactly one
      `Gones League 6` - no `(restored)` duplicate.

## T4 home-card-order

- [ ] `/` signed out: cards read Running tournaments, Leagues (archive), Calendar, About, Settings — Settings is the last card and spans the full row.
- [ ] `/` signed in: cards read Running tournaments, Leagues (archive), Calendar, Registrations, About, Settings — Registrations appears fourth, About and Settings are both half width.

## T5 header-sign-in-last-and-import-label

- [ ] `/leagues-archive` signed out: header reads logo … Import league(s) · Full data export · Sign in, with Sign in right-most.
- [ ] `/leagues-archive` signed in: header ends … Full data export · username · Log out, with the account block right-most.
- [ ] `/settings`, a league detail page, and a live tournament runner page: the sign-in/account block is right-most on each, after that page's own action buttons.
- [ ] The league import button reads "Import league(s)" in English and "Importer ligue(s)" in French, and clicking it still opens the file picker.

## T6 calendar-toolbar-row

- [ ] Signed in with a verified email, `/calendar`: one row reads `[Calendar] [List] ————— [Create tournament]`; the create button is filled success-green and clicking it navigates to `/tournaments/new`.
- [ ] Signed out (or signed in but unverified), `/calendar`: that row shows only the two `Calendar`/`List` toggle buttons — no create button.
- [ ] `/calendar` in both the calendar tab and the list tab: the search input has a visible 1px steel border and a dark (`--black-metal`) fill; the strip of page around the input (the search row) has no border and no background of its own.
- [ ] Narrow the browser window below ~600px: the two toggle buttons and the create button each stack to full width, one per row, and the create button does not get pushed into an oddly-indented partial row.

## T7 calendar-day-cell-events

- [ ] `npm run dev -- --env=demo`, sign in as any user with tournaments in the current month, `/calendar` on the calendar tab: each tournament's title and start time render inside its day square in the month grid, and clicking a tournament link opens `/calendar/tournaments/{slug}`.
- [ ] Still on the calendar tab: nothing is listed below the month grid — no card list, no date-group headings, no pager.
- [ ] Type in the search box: the day cells thin to only the matching tournaments (a day cell with no remaining match shows no events).
- [ ] A day with more than 3 tournaments shows exactly 3 event links plus a "+N more" line ("+N de plus" in French); a day with 3 or fewer shows all of them and no "+N more" line.
- [ ] Switch to the list tab: the grouped cards and the pager are still there, unchanged from before this slice.
- [ ] Narrow the browser window below ~600px: a day cell with events is visibly taller than an empty one (not clipped to the empty-cell height).

## T8 create-dialog-enter-submit

- [ ] `/leagues-archive` → click "New League": the dialog opens with the name input already focused (cursor blinking, no click needed).
- [ ] Type a league name, press Enter: the dialog closes, the league is created, and the browser navigates to the new league's detail page.
- [ ] Re-open the dialog, press Enter with the field empty: nothing happens — dialog stays open, no league created.
- [ ] Re-open the dialog, press Escape: the dialog closes with no league created.
- [ ] Click the confirm button directly (not Enter) with a name typed in: still creates the league (button is `type="submit"` inside the form, same path as Enter).

## T9 oauth-button-alignment

Automated coverage (`src/app/auth/auth-entry.layout.test.ts`) proves both `/login` and `/register`
OAuth blocks share the same `auth.continueWith` label key (label before logo, 4 occurrences), that
every logo carries a translated `[attr.alt]` (`auth.continueGoogle` / `auth.continueFacebook`, no
`alt="Google"`/`alt="Facebook"` literals, no `aria-hidden` on the logo), and that `.oauth-button` /
`.oauth-button__logo` in `src/styles.css` carry the new spacing (`gap: .75rem`, `min-height: 3rem`)
and centring (`align-self: center`) rules. It cannot prove rendered pixels, French runtime text, or a
live viewport — those need a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/login` — both buttons read "Continue with" then the
      logo, with visible gap between text and logo (not jammed together) and the logo's vertical
      centre lines up with the text's vertical centre.
- [ ] Open `/register` — its two OAuth buttons now read the exact same text ("Continue with"), same
      order (label then logo), same spacing/alignment as `/login`.
- [ ] Switch the app language to French on both pages: buttons read "Continuer avec" then the logo.
- [ ] Narrow the window below ~600px on both pages: the OAuth grid drops to one column and each
      button still centres its label/logo pair.

## T10 auth-return-buttons

Automated coverage (`src/app/auth/auth-return-link.test.ts`, `src/app/auth/auth-entry.layout.test.ts`)
proves the pure `authReturnLink(mode)` mapping for all six modes (`login`/`register` → `['/']`,
`complete-profile` → `null`, `verify-email`/`forgot-password`/`reset-password` → `['/login']`) and that
the component renders exactly one `gones-back-button`, guarded by `@if (returnLink(); as link)`,
carrying `data-cy="auth-back-button-top"`. It cannot prove rendered pixels, French runtime text, or a
live viewport — those need a human:

- [ ] `npm run dev`, open `http://127.0.0.1:4200/login` — a "Return to Menu" button sits above the
      card; clicking it lands on `/`.
- [ ] Open `/register` — same "Return to Menu" button above the card, lands on `/`.
- [ ] Open `/forgot-password` — a "Back to sign in" button sits above the card; clicking it lands on
      `/login`.
- [ ] Open `/reset-password?token=anything` — same "Back to sign in" button, lands on `/login`.
- [ ] Open `/verify-email?token=anything` — same "Back to sign in" button, lands on `/login` (the
      in-card "Back to sign in" link at the bottom still works too, unchanged).
- [ ] Open `/auth/complete-profile` (mid-OAuth) — no return button of either kind above the card.
- [ ] Switch the app language to French on `/login` and `/forgot-password`: buttons read "Retour au
      menu" and "Retour à la connexion" respectively.

## T11 account-page-actions

Automated coverage (`src/app/features/settings/account-settings.component.test.ts`) proves the
template source no longer contains `data-cy="account-logout-row"` or `data-cy="account-logout"`,
that `async logout()` is gone from the component (its only caller was that row), that the
`data-cy="account-save"` button carries `account-save-action`, that the `.account-save-action`
stylesheet block sets `display: block`, `width: 100%`, and `margin: 1.5rem auto 0`, and that
`src/app/app.component.ts` still carries `data-cy="logout-button"` wired to `(click)="logout()"`. It
cannot prove rendered pixels or a live click-through — those need a human:

- [ ] `npm run dev`, sign in, open `/settings/account`. Scroll to the bottom of the page: there is no
      standalone "Log out" button below the danger-zone card.
- [ ] The app toolbar's own account menu still has a working "Log out" entry; clicking it signs you
      out and lands on `/`.
- [ ] On `/settings/account`, the "Update account information" ("Modifier Information du Compte" in
      French) button spans the full width of its card, is visually centred, and sits with clear space
      below "Change email" ("Changer l'e-mail").

## T12 signed-out-local-catalogs

Automated coverage proves the flags and the wiring: `src/app/features/settings/settings-capabilities.test.ts`
(the two local flags are the exact complement of the server ones — anonymous/`User` get both, an
`Organizer` keeps only the local catalog, an `Admin` on an `adminV1` build gets neither),
`src/app/features/settings/local-player-names.test.ts` (match + bye folding, case folding across two
leagues, blank names skipped) and `src/app/features/settings/settings.component.test.ts` (each card
lives inside its `@if (capabilities().local…)` guard, and no local template block or local method body
contains `this.client.`). `src/app/backend/server-authority-boundary.test.ts` allowlisted exactly
three IndexedDB files at the time of that slice; T13 added the fourth (`server-read-cache.service.ts`,
ADR 0031), which changes nothing the T12 checks below depend on. Committed
`cypress/e2e/settings-local.cy.js` proves, signed out with every `/api/` call stubbed: both local cards
render, an added archetype survives reload, renaming `Local Alice` → `Local Alicia` rewrites the
`gones-leagues` row, and no API call other than `auth/refresh` occurs; signed in as `Admin`, both local
cards are absent.

**Made partly stale by T14 (remote prevails on sign-in).** Signing in — and reloading with a live
session — now replaces this browser's deck-archetype list with the server's, so a local archetype
added while signed out (`Manual Check` below) is gone after the first sign-in and does **not** come
back on sign-out. Run the archetype steps below in one signed-out stretch, before the sign-in step at
the end of this list. The local **Players** card is unaffected: it is derived from the browser-local
leagues, which sign-in never touches.

What it cannot prove — rendered pixels, a second browser tab, and the League detail page after a
rename — needs a human:

- [ ] `npm run dev`, signed out, open `/settings`: a **Deck archetypes** card and a **Players** card sit
      below the account card. Each is a collapsed expansion panel with the browser-only help text
      ("stored in this browser only" / "leagues stored in this browser").
- [ ] Expand Deck archetypes, add `Manual Check`, then reload the page: the archetype is still listed
      (it lives in `localStorage` under `gones.settings`).
- [ ] Open the site in a **second tab**, still signed out, `/settings`: the same archetype list and the
      same players are there — both stores are origin-scoped, not user-scoped.
- [ ] From `/leagues-archive`, create a local league with one tournament and a round naming two
      players. Back on `/settings` → Players: both names appear with their entry/league counts.
- [ ] Rename one of them and open that league's detail page: the round entries show the new name.
- [ ] With DevTools → Network open, add and delete an archetype and rename a player: no request is
      issued at all.
- [ ] Delete an archetype: a confirmation dialog appears first, naming the archetype, with a red
      confirm button; cancelling leaves the list untouched.
- [ ] Sign in as `admin@gones.test`: the local Deck archetypes and Players cards are gone and the
      server-backed Admin catalog + Players sections are shown instead. Sign in as
      `organizer@gones.test`: the **local** Deck archetypes card is still shown (an Organizer has no
      server catalog) while Players is the server-backed one.
- [ ] Switch the language to French on `/settings`: both new help paragraphs read in French.

## T13 authenticated-offline-read-cache

Automated coverage proves the rules: `src/app/backend/server-read-cache.service.test.ts` (a fulfilled
read overwrites its row, a failed read falls back flagged `stale`, a failed read with no row rethrows,
an anonymous caller caches nothing, two users never share a row, a read that lands after logout or
after the next sign-in is written nowhere, an IndexedDB failure is a swallowed-and-logged write or a
silent miss), `src/app/auth/session-scope.service.test.ts` (`clear()` empties the cache, and neither
the next user nor the same user can read a row afterwards), `src/app/data/league-archive-repository.service.test.ts`
(the cached list is served when the server is unreachable and `serverUnavailable()` says so; a
fulfilled read replaces rather than merges; a `local-` league is never cached) and
`src/app/data/live-tournament-repository.service.test.ts` (cached under `aspnet-api`, never under
`browser-local`, never for a mutation). `src/app/backend/server-authority-boundary.test.ts` now
allowlists exactly four IndexedDB files. `src/app/backend/server-read-cache.service.test.ts` now also
runs the production IndexedDB adapter through row round-trip, whole-DB purge, recreation, and deletion
while a second same-app connection closes on `versionchange`.

A throwaway Cypress run (not committed, dev server + stubbed API) additionally observed, signed in as
an Organizer on `/leagues-archive`: the `gones-cache` / `reads` store held exactly one row keyed
`<userId>:leagues` with a `cachedAt` stamp; after the league requests were killed and the page
reloaded, the league still rendered and `[data-cy="leagues-archive-server-unavailable"]` was present;
after **Log out**, `indexedDB.databases()` no longer contained `gones-cache`.

What that cannot prove — the real API, a real offline switch, real running tournaments, and a second
real account — needs a human:

- [ ] `npm run dev -- --env=demo`, sign in as `organizer@gones.test` (`Gones-dev-pass-123!`), open
      `/leagues-archive` and `/live-tournaments` so both load. DevTools → Application → IndexedDB shows
      `gones-cache` → `reads` with rows keyed by that user's id (`<userId>:leagues`,
      `<userId>:live-tournaments`).
- [ ] DevTools → Network → **Offline**, reload both pages: the archived Leagues and the running
      tournaments still render, and the League page shows its "server unavailable" notice.
- [ ] Still offline, try a write (create a League, add a Live player): it fails with an error — nothing
      is queued and nothing is replayed when the network returns.
- [ ] Back online, reload `/leagues-archive`: the notice is gone and the rows are refreshed (`cachedAt`
      moves forward).
- [ ] Log out: `gones-cache` is gone from DevTools → Application → IndexedDB.
- [ ] Sign in as `test@gones.test` in the same browser: none of the Organizer's archived Leagues or
      running tournaments appear, online or offline.
- [ ] Signed out entirely, open `/calendar` offline: the public catalog still renders from its own
      `localStorage` snapshot — this slice did not touch it.

## T14 remote-prevails-on-sign-in

Automated coverage proves the conflict rule and the scoping property:
`src/app/shared/deck-archetype-settings.service.test.ts` (the server catalog replaces the local one —
`Server A`/`Server B` in, `Local Only` out, presets kept, `gones.settings` rewritten; the language
survives the adoption; an *empty* server catalog still erases the local additions),
`src/app/auth/session-catalog-sync.service.test.ts` (the fetched names reach
`adoptServerCatalog`; a failing `GET /api/deck-archetypes` calls it never and resolves without
throwing, so an offline sign-in changes nothing), `src/app/auth/auth.service.test.ts` (`adopt()` runs
exactly once per sign-in and only after the profile landed; logging out adopts nothing),
`src/app/auth/auth.service.bootstrap.test.ts` (a restored session adopts too, a failed bootstrap does
not) and `src/app/backend/browser-local-scope.test.ts` (`gones-leagues` / `gones-live` are plain
constants, and the three browser-wide sources name no `profile()`, no `userId` and no `auth.service`
— asserted inversely against the read cache, which does all three). `npm run test` 862/862,
`npx vitest run src/app/backend/server-authority-boundary.test.ts` 12/12 with both allowlists
unchanged, and `cypress/e2e/settings-server.cy.js` 4/4 on the running dev server.

Nothing local is ever uploaded: the only new network call is a read, `GET /api/deck-archetypes`.

What that cannot prove — the real API, a real second browser session, and a real offline sign-in —
needs a human:

- [ ] `npm run dev -- --env=demo`, signed out, open `/settings` → Deck archetypes and add
      `Local Only`. Sign in as `admin@gones.test` (`Gones-dev-pass-123!`), then sign out again and
      reopen `/settings`: `Local Only` is gone and the server catalog names are listed instead.
      Remote prevailed and erased the local list.
- [ ] Signed out, open the site in a private window, add an archetype, then open a **second tab** of
      that same private session: the archetype is there. The local stores are browser-wide, not
      user-scoped.
- [ ] DevTools → Network → **Offline**, then reload the app with a live refresh cookie: the local
      catalog is unchanged, nothing throws, and the console shows only the swallowed
      `session-catalog-sync.adopt` boundary log.
- [ ] Signed in, DevTools → Network: `GET /api/deck-archetypes` is issued once per sign-in and no
      request ever carries a local archetype name in its body.

## T15 reviewer-blocker-repair

Automated coverage now proves session-bound cache fallback, awaited purge/bootstrap registration,
production IndexedDB deletion/recreation, OAuth catalog adoption with delayed-session guards, visible
cached-server warnings, local-player partial-failure reload, local-Docker endpoint refusal,
case-insensitive fixture refs, validator negatives, calendar day-cell events, and signed-out local
Settings persistence. Demo seeding is run twice before Cypress; committed fixture identities are
synthetic while dataset counts, pairings, archetypes, scores, and League/Live shapes remain stable.

Human-only visual checks remain open:

- [ ] In a second real browser tab, log out with `gones-cache` open: both tabs close their cache DB
      connections and logout finishes with `gones-cache` absent.
- [ ] Force League detail and Live list/runner server reads offline after one online load: each page
      shows its cached-server warning; browser-local League/Live pages show no such warning.
- [ ] Review calendar day-cell links at desktop and narrow widths for clipping/readability; automated
      Cypress proves correct date, time/title, route, filtering, and 3-plus-overflow behavior.

## T16 post-review-concurrency-and-proof-repair

Automated tests cover auth-transition serialization, purge retry/error truth, queued Web Lock session
guards, partial-rename reload failure, fresh-mutation stale-warning clearing, and literal IndexedDB
schema behavior. Human-only browser checks remain open:

- [ ] In two real tabs, hold `gones-cache` deletion blocked during user A logout, then attempt user B
      sign-in: B must not publish profile/catalog/cache state until deletion completes, and B data must
      remain after A logout finishes.
- [ ] Force cache purge failure after successful account deletion: UI remains signed out without a
      false deletion-failed message; after storage recovers, next sign-in succeeds only after purge.
- [ ] Queue server catalog adoption behind the Deck Archetype Web Lock, then sign out or switch users:
      stale session catalog must not replace current browser catalog.
- [ ] Force second local League player rename write and final player reload to fail: partial-change
      review/retry warning remains visible rather than generic load-failed copy.
- [ ] Load cached League and Live detail, restore network, then perform successful edits/creation:
      cached-server warning clears; failed edits leave warning visible.

## T17 auth-cross-tab-final-review-repair

Automated tests cover real interceptor wiring for profile/email 401 refresh replay, exact account-DELETE
refresh suppression, teardown/establishment ordering, generation-scoped stale-cache rejection,
no-Web-Locks fail-closed behavior, and exact coordination-storage containment. Human browser/multi-tab
checks remain open:

- [ ] In two real tabs as user A, delay a private read in tab B, then log out in tab A and let cache
      deletion finish before releasing B's response: `gones-cache` stays absent and no user-A row is
      recreated.
- [ ] In two real tabs, start user B sign-in while user A logout has cache deletion blocked: B shows
      no profile/catalog/private cache state until deletion completes, then signs in normally.
- [ ] With an expired access token, update profile and request an email change: each 401 refreshes and
      replays once without hanging; wrong-password account deletion rejects once without refresh.
- [ ] In a browser context with Web Locks disabled, login/OAuth/bootstrap/refresh make no auth network
      request or session publication; logout/clear still remove local auth and purge private cache.

## T1 session-ready-auth-guards

Automated tests cover the guard decisions themselves (unit tests for the four guards, plus a Cypress
spec for the signed-out `/registrations` redirect and the signed-in pass-through). What no automated
test covers is a real browser session restored from the refresh cookie on a real network:

- [ ] Signed out, hard-reload `/registrations` (Ctrl+Shift+R): you land on `/login?returnUrl=%2Fregistrations`
      and the registrations page never flashes on screen, not even for a frame.
- [ ] From that login page, sign in: you land back on `/registrations` and the list loads.
- [ ] Signed in, hard-reload `/registrations` directly: the page renders and you are never bounced to
      `/login` while the startup refresh is still running.
- [ ] Throttle the network to "Slow 3G" in DevTools and hard-reload `/registrations` while signed in:
      the app waits for the session restore, then shows the page — no redirect to `/login`.
- [ ] Signed in as a plain User, open `/admin`: you are sent to `/` with `?denied=/admin`.
- [ ] Signed in as an Organizer, open `/organizer/tournaments`: the page renders; open `/admin`: you are
      sent to `/` with `?denied=/admin`.
- [ ] With an unverified e-mail, open `/tournaments/new`: you are sent to `/verify-email?email=<your address>`.
- [ ] Sign out from a page behind a guard: you are moved off it and cannot reach it again with the back button.

## T2 calendar-past-day-styling

A past day is a **darker cell with a muted day number**, not a faded cell: the first attempt used
`opacity: .5` on the whole cell, which dragged the event chips and the day numbers down to 2.1:1 and
failed the axe gate. The event chips on a past day now render at full strength. Automated tests cover
the pure `isPastCalendarDay` helper, the template bindings, the CSS rules and the axe contrast gate.
What no automated test covers is whether the recessed cell still *reads* as past to a human eye,
across zoom levels and on a date that is not the day the change was written.

- [ ] Open `/calendar` in the month view on today's real date: every cell before today has a visibly
      darker background than today's cell, and its day number is the softer, lighter-weight one.
- [ ] Today's cell is not darkened and its day number is still the bright, heavy one.
- [ ] Tomorrow and the rest of the month are not darkened.
- [ ] Cells from the previous month that are already greyed out go one step darker again when they are
      past — they still read as a different shade from the greyed-out *next*-month cells at the bottom
      of the grid, and their numbers stay perfectly readable.
- [ ] A tournament chip sitting on a past day is at full strength — same red left bar, same crisp
      title and time as a chip on a future day — and it is still clickable and opens the right
      tournament page.
- [ ] A past day carrying more than three tournaments still shows the "+N more" marker, at the same
      legibility as on a future day.
- [ ] Page back a month: every cell is darkened. Page forward two months: nothing is darkened.
- [ ] Zoom the browser to 200%: past day numbers and past-day chips are still comfortably readable.
- [ ] Squint at the grid from a step back: the past block still separates from today and the days to
      come without anything looking washed out or broken.
- [ ] Leave the calendar open past local midnight, then reload: yesterday is now darkened too.

## T3 list-card-click-hover-time

Automated tests cover the pure date helper, the template bindings, the hover CSS rules and a browser
run that clicks the card and the ICS button. What no automated test settles is how the lift *feels*,
whether a real download lands on disk, and whether the card still reads as a link to a real screen
reader and a real pointing device.

- [ ] Open `/calendar?view=list`: no "View Page" button remains on any card; only "Add to calendar".
- [ ] Hover a card: it lifts slightly, the border warms up and the shadow deepens — smooth, not jumpy.
- [ ] Move the pointer between two neighbouring cards quickly: no flicker, no layout shift pushing the
      list around.
- [ ] Click anywhere on the card background (status, date, venue, summary, empty space): the event page
      opens.
- [ ] Click the event title itself: the same event page opens, once — not a double navigation.
- [ ] Click "Add to calendar": the `.ics` file downloads and you stay on the list.
- [ ] Tab to a card: the focus ring is visible and the card shows the same lift as on hover.
- [ ] With the card focused, press Enter: the event page opens. Go back, press Space: same page, and
      the list does not scroll underneath.
- [ ] Tab to "Add to calendar" and press Enter: the file downloads and you stay on the list.
- [ ] With a screen reader (Orca/NVDA/VoiceOver), move through the list: each card is announced as a
      link named after the event, and the title link and "Add to calendar" are still reachable.
- [ ] Read a card's date line: it shows the venue-local day and time with no `(CEST, Europe/Paris)`
      suffix; the venue line underneath still names the city and country.
- [ ] For an event in a different timezone from yours, the smaller "Viewer time" line is still there
      and still correct.
- [ ] On a phone-width window, the card is still fully tappable and the "Add to calendar" button is
      still easy to hit without triggering navigation.
- [ ] Long-press / drag to select text inside a card, release: no navigation happens on the release.

## T4 search-match-highlighting

Automated coverage proves the parts are computed, the class is bound, the markup-shaped query stays
literal text, and the contrast pair measures 6.76:1. What no automated test settles is whether the
highlight is legible and calm at real sizes, how it behaves on ellipsised and wrapped text, and
whether the player statistics page still looks exactly as it did before the CSS moved to global.

- [ ] Open `/calendar?view=list` and type `lyon` in the search box: the matching letters inside the
      card title, date line, venue line and summary come up highlighted, the rest of the text does not.
- [ ] Switch to the calendar view with the same query: the matching letters inside the day-cell event
      titles are highlighted too, and the time prefix is untouched.
- [ ] Read a highlighted card at normal zoom: the highlight is legible, not neon, and the surrounding
      text baseline does not shift when a match appears or disappears.
- [ ] Type an accented query (`lyón`, or `aura` against an event named `Ligue AURA`): the highlight
      still lands on the un-accented letters and the visible text keeps its accents.
- [ ] Type a query that only matches fuzzily (a typo like `lyoon`): the card is still listed, just
      with no highlight — that is the accepted behaviour, not a bug.
- [ ] Narrow the window until a day-cell event title is truncated with an ellipsis: the highlight
      clips with the text and does not force the cell to grow or overflow.
- [ ] Clear the search box: every highlight disappears at once and the text reflows to exactly what it
      was before.
- [ ] Open a player statistics page, type in its match search: the highlighting looks exactly as it
      did before this change (same colour, same rounding, same glow).
- [ ] On a phone-width window, check a highlighted card and a highlighted day cell: no horizontal
      scrollbar, no text overlapping the cell border.

## T5 month-navigation-scroll-anchor

Automated coverage measures `window.scrollY` in a real browser before and after clicking Previous and
Next, in a content-heavy month and in an empty one, and pins `scroll: 'manual'` on the navigation.
What no automated test settles is how the change *feels*: whether the grid twitches, flickers or
reflows while the new month renders, and whether the anchor still behaves on a touch device, at other
zoom levels and after many rapid clicks.

- [ ] Open `/calendar`, scroll down until the month grid fills the window, then click Next: the page
      stays exactly where it was and only the grid contents change.
- [ ] Click Next ten times quickly from the same position: no jump to the top, no drift upwards or
      downwards, no flicker of empty space under the grid.
- [ ] Do the same with Previous, including crossing a year boundary (December to January).
- [ ] Watch the grid closely during one month change: it must not visibly collapse and re-expand while
      the new month renders.
- [ ] Move from a month full of events to a month with none: the page may settle slightly if the
      document became shorter, but it must not snap back to the top.
- [ ] Reach the month buttons with the keyboard (Tab), then activate them with Enter and with Space:
      the scroll position behaves exactly as with the mouse.
- [ ] On a phone-width window, or on a real phone, scroll down and change month: the position holds
      and no horizontal scrollbar appears.
- [ ] At 200% browser zoom, change month: the position holds and the month controls stay reachable.
- [ ] After several month changes, use the browser's Back button: the calendar returns to the previous
      month and the page is not left at a strange scroll position.
- [ ] Change month, then reload the page: the reload starts at the top of the page, as any reload
      should.

## T6 detail-hero-reflow

Automated coverage reads the rendered hero in a real browser: the title text is exactly
`[Legacy] Lyon Legacy (32)`, the date and the location share one row, the actions row is the last
child of the hero with the website button on its right edge, and 375px stays free of horizontal
overflow. What no automated test settles is whether the denser hero still reads well with long
titles, many formats, a long address, French copy, and in the organizer preview.

- [ ] Open an event page (`/calendar/tournaments/…`): the title reads `[Format] Title (capacity)` on
      one line, and the date and the location sit on the single line under it, separated by `-`.
- [ ] Open an event with several formats: the bracket lists them joined by ` / ` and the row still
      wraps gracefully instead of pushing the page wider.
- [ ] Open an event with no capacity, and one with no format: no empty `()`, no empty `[]`, no stray
      spacing left behind.
- [ ] Confirm no organization block and no organization ID appear anywhere on the page — only the
      organization name above the title.
- [ ] Check that the "Organization Website" button sits at the bottom right of the hero card and that
      "Add to calendar" sits to its left; both still open / download correctly.
- [ ] Open an event whose time zone differs from yours: the "Your time" line still appears under the
      date-and-location row.
- [ ] Switch the language to French: the hero labels and buttons stay translated and nothing overflows.
- [ ] Repeat on a phone-width window: title, date-and-location and the buttons wrap without a
      horizontal scrollbar and without the buttons overlapping the text.
- [ ] Open the organizer preview (create / edit a tournament, then look at the rendered preview): it
      shows the same new hero as the public page.
- [ ] Scroll below the hero: the description, participants and registration sections are unchanged.

## T7 venue-maps-link

The location on an event page is now a link to Google Maps, prefixed by a small map-pin icon. The
URL is built in the browser from the venue fields, so the checks below are about the real link
target, the icon and the fallback when an event has no address.

- [ ] Open an event page (`/calendar/tournaments/…`) with an address: the location shows a small
      map-pin icon and reads the same text as before (street, postal code, city, country).
- [ ] Click the location: Google Maps opens in a NEW tab (the event page stays open behind it) and
      lands on that exact address.
- [ ] Come back to the event tab and confirm nothing changed there — no navigation, no lost scroll.
- [ ] Open an event whose address contains an accent, a `&` or a quote: the opened map still shows
      the full address, not a truncated one.
- [ ] Open an event with no address at all: the location is plain text (or empty) with no icon and
      nothing is clickable.
- [ ] Switch the language to French, hover the location: the screen-reader label reads
      "Ouvrir … dans Google Maps"; in English it reads "Open … in Google Maps".
- [ ] Tab to the location with the keyboard: it receives a visible focus ring and Enter opens the
      map in a new tab.
- [ ] Repeat on a phone-width window: the icon and the address stay on the date-and-location row and
      wrap without a horizontal scrollbar.
- [ ] Open the organizer preview of a tournament: the location there behaves the same way.

## T8 registration-action-row-and-dialog

"Add to calendar" and "Register" now sit on the same row inside the Registration block of an event
page, the register button is green, the standalone "My registrations" button is gone, and a
confirmation dialog opens after the server confirms the registration.

- [ ] Open an event page while signed out: the Registration block shows the sign-in prompt and
      "Add to calendar" is still there and still downloads the `.ics` file.
- [ ] Sign in as a user who can register and open an open event: "Add to calendar" and a green
      "Register" button sit side by side on one row, and there is no separate "My registrations"
      button anywhere in the block.
- [ ] Click "Register": the button shows the saving label, and the confirmation dialog appears only
      after the request comes back — never instantly.
- [ ] Read the dialog: it names the event you registered for and offers "Close" and
      "My Registrations".
- [ ] Click "My Registrations" in the dialog: the dialog closes and you land on the My Registrations
      page with that event listed.
- [ ] Register on another event and press Escape instead: the dialog closes, the green status line
      below the actions reads the confirmation, and the keyboard focus is back on that status line.
- [ ] Register once more and check the dialog with the keyboard only: Tab cycles between "Close" and
      "My Registrations" without escaping to the page behind it.
- [ ] Double-click "Register" fast on a fresh event: exactly one registration is created (check the
      participant count and My Registrations) and exactly one dialog opens.
- [ ] Force a failure (register on an event that just filled up, or go offline mid-click): an error
      message appears in the status line and NO success dialog opens.
- [ ] Cancel a registration: the old confirm dialog still appears and behaves as before — no success
      dialog after cancelling.
- [ ] Repeat on a phone-width window: the two buttons stack full width, the dialog fits the screen
      and there is no horizontal scrollbar.
- [ ] Switch the language to French: dialog title, message, "Fermer" and "Mes inscriptions" are all
      translated.
- [ ] Open the organizer preview of a tournament: the hero looks exactly as before this change
      (no registration row, no "Register" button).

## T9 demo-accounts-doc

- [ ] Run `npm run dev -- --env=demo` on a machine you are happy to reset, then open
      `DEMO_ACCOUNTS.md`: every email in the table can sign in with the password the file documents.
- [ ] Sign in as `admin@gones.test`: the admin screens are reachable and every organization is
      visible, as the "What they can do" column claims.
- [ ] Sign in as `organizer@gones.test`: the organization offered when creating or publishing an
      event is "Gones Lyon" — the one the table lists on that row — and no other.
- [ ] Sign in as `organizer2@gones.test`: same check against "Ligue AURA".
- [ ] Sign in as `test@gones.test` (plain user): the calendar, event registration and
      My Registrations all work, and no organizer or admin entry point appears.
- [ ] Sign in as `unverified@gones.test`: the app blocks the write actions and points at email
      verification, matching the "cannot write until the email is verified" note and the `no` in the
      "Email verified" column.
- [ ] Run `npm run dev:accounts` on a stack that is already up: only `admin@gones.test` and
      `test@gones.test` are (re-)seeded, and both still sign in with the documented password.

## T10 org-membership-read-model

- [ ] Sign in as `admin@gones.test`, then in a terminal read a roster with that admin's token:
      `curl -H "Authorization: Bearer <admin token>" http://127.0.0.1:5080/api/admin/organizations/<org id>/members`.
      Each row shows only the member's `userId`, `username`, `email`, `globalRole`, `role` and
      `createdAt` — no password hash, no token, no email-verification field.
- [ ] Repeat the same URL with no `Authorization` header at all: the API answers 401 and returns no
      roster body.
- [ ] Repeat it with the token of `test@gones.test` (plain user): 403, no roster body.
- [ ] Repeat it with the token of `organizer@gones.test`, who owns "Gones Lyon", against the
      "Gones Lyon" id: still 403 — owning an organization does not grant the admin read.
- [ ] Ask for a roster with a random UUID as the organization id, using the admin token: 404.
- [ ] As admin, soft-delete an organization from `/admin/organizations`, then read its roster with
      the admin token: it still answers 200 and still lists the members.
- [ ] Read `GET /api/admin/organizations/` as admin and check the list: every item carries a
      `memberCount`, and `isDraft` is true only where `memberCount` is 0.
- [ ] Open `/admin/organizations` in the browser as admin: the list, the create form, the edit form,
      delete and restore all behave exactly as before.
- [ ] Re-run `npm run backend:test` on a host whose ephemeral port range
      (`sysctl net.ipv4.ip_local_port_range`) does NOT overlap rootless docker's published-port range,
      and confirm 0 failures — the failures seen on the development host are Testcontainers startup
      errors (`RootlessKit PortManager.AddPort(): bind: address already in use`), not test failures.

## T11 derived-organizer-role-and-draft-orgs

- [ ] Sign in as `admin@gones.test` and, from `/admin/organizations`, add `test@gones.test` (a plain
      user) to any organization. Then sign in as `test@gones.test`: the account now behaves as an
      organizer — the organizer entry points appear and that organization is offered when publishing
      an event.
- [ ] Do the same, but keep an already-signed-in `test@gones.test` browser tab open in a second
      profile *before* the admin adds them. The moment the admin adds them, the open tab's next
      action fails and the app sends them back to sign in: the change is enforced on the very next
      request, not at the next token refresh.
- [ ] With `test@gones.test` now an organizer of exactly one organization, have the admin remove
      them from it. Sign in as `test@gones.test` again: every organizer entry point is gone and no
      organization is offered when publishing.
- [ ] Repeat that removal while `test@gones.test` has a signed-in tab open: that session stops
      working immediately too, and "stay signed in" does not resurrect the organizer role.
- [ ] Add `admin@gones.test` to an organization, then remove them from it. In both cases the admin
      screens stay reachable and the account is still an administrator — membership never moves an
      Admin, in either direction, and the admin's own session is not signed out.
- [ ] As admin, remove the last remaining member of an organization: the removal succeeds (no
      conflict message), the organization is still listed, and it now shows as a Draft with 0 members.
- [ ] While that organization is a Draft, edit its name and description, delete it, then restore it:
      all four still work.
- [ ] As admin, try to publish an event for that Draft organization: the API refuses with
      "Organization has no organizer and cannot publish." Add an organizer back and publish the same
      event again: it goes through.
- [ ] As `organizer@gones.test`, publish an event for "Gones Lyon" (a staffed organization): the
      whole publish flow is unchanged from before this ticket.
- [ ] As the sole Owner of an organization that still has another member, try to remove yourself:
      the app still refuses and asks you to transfer ownership first.
- [ ] As admin, create a brand-new organization from `/admin/organizations` and give it an owner who
      is currently a plain user (`test@gones.test` with no membership). Sign in as that owner: they
      are an organizer straight away — creating the organization is what promoted them, no separate
      "add member" step needed.
- [ ] Do that same creation while the future owner has a signed-in tab open in a second profile:
      their next action in that tab fails and sends them back to sign in.
- [ ] As admin, transfer an organization's ownership to someone who is *not* a member of it yet.
      Sign in as the new owner: they are an organizer. The previous owner is still a member and still
      an organizer; remove them from the organization and they drop back to a plain user.
- [ ] Transfer an organization to `admin@gones.test`: the admin screens still work and the account is
      still an administrator.
- [ ] As admin, close an account that solely owns an organization (`/admin/users` → disable) and hand
      that organization to a plain user. The account that inherits it becomes an organizer, any open
      tab of theirs is signed out on its next action, and the closed account keeps no organization and
      no organizer role.
- [ ] Close an account whose organization is handed to `admin@gones.test`: the admin stays an
      administrator.
- [ ] As admin, soft-delete an organization whose only member is one account, then close that
      account. The closure goes through without asking for an ownership transfer; restore the
      organization afterwards and it shows as a Draft with 0 members.
- [ ] Fire an account closure and a membership change on the same account at the same time (two
      terminals, one `POST /api/admin/users/<id>/disable`, one
      `DELETE /api/organizations/<org>/members/<id>`): both answers are ordinary ones — a success or a
      409/404 problem document. Neither is a 500 and the API log records no `deadlock detected`.

## T12 membership-heal-migration

- [ ] Before running the migration job on a real database, take the backup from `docs/OPERATIONS.md`
      §7 and note where it is. The heal cannot be undone by a down-migration; that backup is the only
      way back from a wrong run.
- [ ] Before the job, list what it is about to change and keep the list:
      `select id, name from organizations o where o.deleted_at is null and o.id not in (select organization_id from organization_members);`
      and
      `select id, email from asp_net_users where global_role = 'Organizer' and id not in (select user_id from organization_members);`
      Nothing outside those two lists may move.
- [ ] Run the migration job. Afterwards, compare
      `select action, count(*) from audit_records where action like 'organization.healed.%' group by action;`
      against the two lists: one `organization.healed.archived` row per organization, one
      `organization.healed.demoted` row per account, no more and no fewer.
- [ ] Re-run the migration job. It exits 0, the audit counts above are unchanged and nothing else
      moved: the heal runs once, not on every deploy.
- [ ] As an administrator, open `/admin/organizations` with "include deleted" on: every archived
      organization from the list is there, shown as a Draft with 0 members. Restore one of them — it
      comes back live and can be worked on again.
- [ ] Check the archived list for organizations that still had published events, and restore those:
      archiving hides an organization, and a legacy organization with no members but live events is
      the one case an operator has to look at by hand.
- [ ] Sign in as one of the demoted accounts: it is a plain user, its old session no longer works,
      and the organizer entry points are gone. Add it to any organization and it is an organizer
      again on the next sign-in — the heal only removed a role that no membership backed.
- [ ] Confirm no administrator was touched: every account that was an `Admin` before the job still
      reaches the admin screens, whether or not it belongs to an organization.
- [ ] Confirm nothing was invented: no account gained a role and no organization gained a member.
      An account that holds a membership but is still a plain user stays a plain user until the next
      membership change is made through the app.

## T13 admin-organization-workbench

- [ ] As an administrator, open `/admin/organizations`. The screen is two panes: organizations on the
      left, an empty right pane telling you to pick one. Nothing is selected yet.
- [ ] Click "New organization", create one with yourself as owner. It appears in the left list with
      the member count you expect. Cancel-free reload of the page keeps the list intact.
- [ ] Select an organization. The right pane fills with its name, its edit form and its organizer
      chips, the left row is visibly marked as the current one, and the address bar gained
      `?organization=<id>`. Reload the page — the same organization is still selected.
- [ ] Type a few letters of a username in the member search. Only matching accounts are offered, each
      showing username, e-mail and current global role, and accounts already in the roster are not
      offered a second time.
- [ ] Click an account. It becomes an organizer chip without a second confirmation, and the left row's
      member count goes up. Open `/admin/users` in another tab: that account is now `Organizer`.
- [ ] Remove a member. You are asked to confirm, by name, before anything happens. Say no once and
      nothing changes; say yes and the chip disappears and the count drops.
- [ ] Remove the last member of an organization. It is allowed, and the left row now carries the Draft
      badge with 0 members. On `/admin/users`, the removed account is a plain `User` again unless it
      still belongs to another organization.
- [ ] While that organization is a Draft, try to publish one of its events from the organizer screens.
      The refusal is shown as a readable message on screen, not a silent failure.
- [ ] Try to remove the sole Owner of an organization that still has other members. The server refuses
      and the refusal text is visible on the organization screen.
- [ ] Edit the selected organization (name, description, website, contact e-mail) and save. The left
      list shows the new name. Delete it — the selection clears and the right pane returns to its
      empty state. Turn on "include deleted", select it again and restore it.
- [ ] Page through the organization list with the previous/next buttons while an organization is
      selected: the selection and the roster stay on the organization you picked.
- [ ] Narrow the browser to phone width. The two panes stack instead of scrolling sideways, and every
      control is still reachable.
- [ ] Walk the whole screen with the keyboard only: Tab reaches the search field, the create toggle,
      every organization row, every chip's remove button and every picker option, and the focus ring
      is visible on each.
- [ ] On a site with more than 500 accounts, confirm the picker shows the "only the first 500 accounts
      are listed" warning and that the accounts it does list are usable.

## T14 admin-all-organizations-picker

- [ ] Sign in as `admin@gones.test` and open `/tournaments/new`. The organization picker offers every
      active organization on the site — including ones you do not belong to — sorted by name, not the
      empty list an administrator's own memberships would produce.
- [ ] Pick an organization you are not a member of, fill the form, preview and publish. The event is
      created and you land on its public detail page under that organization's name.
- [ ] In `/admin/organizations`, remove the last member of an organization so it carries the Draft
      badge. Reload `/tournaments/new`: that organization is no longer offered in the picker. Staff it
      again and it comes back.
- [ ] Delete an organization from `/admin/organizations`, then reload `/tournaments/new`: the deleted
      organization is not offered. Restore it and it is offered again.
- [ ] Sign in as `organizer@gones.test` and open `/tournaments/new`. The picker still shows only the
      organizations that account belongs to — `Gones Lyon` and nothing else.
- [ ] Sign in as `test@gones.test` (plain user) and open `/tournaments/new`. The picker still shows the
      public catalogue and the page still offers "submit for approval", not direct publishing.
- [ ] As an administrator, keep `/tournaments/new` open, have the API go down (or block
      `/api/admin/organizations` in the browser dev tools) and reload. The picker falls back to your
      own memberships rather than going empty; when nothing at all can be loaded the page shows the
      reference-load error with a working Retry button.
- [ ] Walk `/tournaments/new` as an administrator with the keyboard only: Tab reaches the organization
      picker, arrow keys move through the options and the focus ring stays visible.

## T15 backend-event-entity-rename

The calendar's database tables and CLR types are now named after Event. Nothing users see should have
moved: the API still answers on `/api/tournaments/*` and the frontend is untouched until T16. These
steps look for the things automated tests cannot see — that real rows survived and that the app still
behaves exactly as it did before the rename.

- [ ] Before deploying, record the row counts of the calendar tables under their old names:
      `select count(*) from scheduled_tournaments;` and the same for `scheduled_tournament_formats`,
      `tournament_registration_attempts`, `tournament_lifecycle_events`, `tournament_proposals`,
      `tournament_proposal_recipients`, `consumed_tournament_preview_tickets`. Keep the numbers.
- [ ] Deploy and re-run the counts under the new names: `events`, `event_formats`,
      `event_registration_attempts`, `event_lifecycle_entries`, `event_proposals`,
      `event_proposal_recipients`, `consumed_event_preview_tickets`. Every number matches the one you
      recorded. If any count dropped, stop and roll back — the migration is a rename, so a smaller
      number means data was lost.
- [ ] Confirm the old table names are gone: `select to_regclass('public.scheduled_tournaments');`
      returns empty. A row here means the migration only half-applied.
- [ ] Confirm the tables that must NOT move are still there: `tournament_formats`,
      `league_archive_aggregates`, `live_aggregates`, `scheduled_notifications`, `notification_history`.
- [ ] Open `/calendar` as an anonymous visitor. The same events are listed as before the deploy, in the
      same order, with the same formats, cities and dates.
- [ ] Open one event's detail page. Title, description HTML, venue, capacity and the participant count
      all render as before.
- [ ] Filter the calendar by format and by city. Results are unchanged and the page stays fast — these
      queries rely on indexes that the migration renamed.
- [ ] Sign in as `test@gones.test` and register for an upcoming event, then unregister. Both succeed
      and the participant count moves accordingly.
- [ ] Sign in as `organizer@gones.test`, publish a new event, edit its date, then cancel it. Each step
      succeeds and the event's status is correct on the public page.
- [ ] As a plain user, submit an event request for approval; as an organizer, open the emailed review
      link and approve it. The approved event appears in the calendar.
- [ ] Check the reminder emails still schedule: after publishing an event and registering for it, the
      worker plans reminders (`select count(*) from scheduled_notifications where event_id = '<id>';`
      is greater than zero).
- [ ] Try to delete an account that created an event. The refusal still lists the blocking relations,
      and those labels still read `scheduled_tournaments.created_by_user_id` etc. — they are the
      unchanged API wire shape, not the new table names, and T16 is where they change.
- [ ] Export a Gones backup and re-import it into a clean environment. The import report still counts
      "Scheduled Tournaments" and the imported events land in the calendar.
