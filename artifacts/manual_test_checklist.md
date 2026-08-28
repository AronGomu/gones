<!-- Retirement notice: keep at the top; it governs every section below. -->
> ## ⚠ The legacy archive surface is retired (T19 retire-legacy-surface)
>
> Every section below that was written before **T19 retire-legacy-surface** — the last section in
> this file — is a record of what was true when that slice shipped. The surface many of them use as
> their "nothing else moved" control no longer exists, so those bullets are **not re-runnable**.
> Nothing has been deleted from them: a year-old commit message still has to resolve against this
> file.
>
> What changed, and what to read instead:
>
> | Retired | Now |
> | --- | --- |
> | `/leagues`, `/leagues-archive`, `/leagues-archive/:id`, `/leagues-archive/:id/tournaments-archive/:tid[/result[/metagames]]` | the 404 page, with no redirect and the address bar unchanged |
> | `GET/POST/PATCH/DELETE /api/leagues-archive/**` | `404`; the archive is `/api/archive/**` |
> | `/leagues-archive` list page | `/archive/league-seasons` |
> | a legacy Tournament page | `/archive/tournaments/:tournamentId` |
> | `GET /api/leagues-archive/all` | `GET /api/archive/leagues/all`, `GET /api/archive/league-seasons/all`, `GET /api/archive/tournaments/all?year=` |
> | `GET /api/leagues-archive/global-player-statistics[/all]` | `GET /api/archive/global-player-statistics[/all]?scopeKind=&scopeId=` |
> | table `league_archive_aggregates` | `archive_leagues`, `archive_league_seasons`, `archive_tournaments` |
> | the fixed `placeholder-league` row / `Unassigned Tournaments` | a standalone Tournament, `season_id IS NULL` |
> | IndexedDB `gones-leagues` | `gones-archive-local` (browser-local authority) and `gones-archive-cache` (public read cache) |
> | legacy create button on `/leagues-archive` | nothing — import a v5 bundle is the only door (see T19's open gaps) |
>
> A section marked **T19 update** below has the same correction inlined at its head.

## T1 fix-hard-reload-session

- [ ] Open app at `http://localhost:4200`, sign in, press Ctrl-F5, confirm same profile remains visible with no reconnect.
- [ ] In Brave DevTools Network, confirm login and refresh requests use credentials and forced-reload refresh returns 200.
- [ ] In Brave DevTools Application, confirm `gones_refresh` is HttpOnly, host-only, path `/api/auth`, SameSite Lax, persistent, non-Secure on local HTTP.
- [ ] Confirm local storage and session storage contain no access token, refresh token, profile, password, or other credential.
- [ ] Sign out, force reload, confirm refresh is rejected and signed-out UI remains.

## T2 card-hover-auth-button-alignment

- [ ] With fine-pointer device, hover home, Calendar list/month, registration/auth, League, Archive Tournament, Live, player, About cards; confirm consistent hot-red border, small lift, stronger shadow.
- [ ] Hover static cards; confirm cursor stays default.
- [ ] Activate existing card links/buttons via pointer plus keyboard; confirm nav/actions remain unchanged.
- [ ] Enable reduced motion; confirm card hover causes no lift or transition motion.
- [ ] Check sign-in plus register OAuth buttons with both langs; confirm icon plus label remain centered, vertically aligned, single row.
- [ ] Check touch/coarse-pointer viewport; confirm hover lift does not become sticky.

## T3 single-format-event-contract

- [ ] Create Event with one active non-Legacy format; confirm preview/public title uses `Format — base title` and slug ends with format slug.
- [ ] Confirm zero or multiple format selection cannot be submitted and API returns `errors.formatIds`.
- [ ] Create/edit Event with blank, app-relative, HTTP, and HTTPS Live/Archive Tournament links; confirm trimming, blank-to-empty behavior, and round-trip.
- [ ] Try protocol-relative, backslash, control-character, and non-HTTP(S) links; confirm server refuses them.
- [ ] Try deleting format referenced by nondeleted Event; confirm conflict and Event remains editable.
- [ ] Open Calendar list and Event detail; confirm summary stays link-free and detail carries optional links.

## T4 demo-events-and-accounts

- [ ] Load `demo`; confirm Calendar shows 16 Events with one format each and split Events keep shared date, venue, capacity, organization, and base title.
- [ ] Open split Event details; confirm summary and body mention only selected format and slug ends with that format slug.
- [ ] Sign in with each of seven purpose accounts using `Gones-dev-pass-123!`; confirm role, verification state, and organization ownership match account name.
- [ ] Confirm registration counts: user-four 4, user-two 2, Gones Organizer 1, every other demo account 0.
- [ ] Sign in as Gones Organizer; confirm registration for `aura-spring-classic-legacy` is visible.
- [ ] Open Live and League screens; confirm renamed organizer/owner refs resolve and seeded data loads.

## T5 event-detail-layout

- [ ] At desktop width, confirm detail heading shows backend `Format — Title`, localized player count, no status, and right-aligned Live Tournament, Archive Tournament, Organization Website actions.
- [ ] At phone width, confirm detail info actions and Participants header actions wrap without horizontal overflow.
- [ ] Confirm app-relative Tournament links stay in same tab; absolute HTTP(S) links open a new tab with `noopener noreferrer`.
- [ ] Confirm Add to Calendar plus Sign in/Register/Cancel registration appear beside Participants; Register remains green and Cancel remains danger ghost.
- [ ] Confirm Register, Cancel registration, Add to Calendar, capability/reason/offline states, and registration success dialog still work.

## T6 calendar-register-resume

- [ ] Open Calendar list signed out; confirm each Event card shows backend Format — Title plus start time, no status/date line, Add to Calendar plus green Register on one action row.
- [ ] Activate card body, Add to Calendar, and Register using pointer, Enter, and Space; confirm only card body opens Event detail.
- [ ] Follow anonymous Register through account creation, verification email link, Verify Email, and Login; confirm Calendar returns with registration confirmation and no registration happens before confirmation.
- [ ] Cancel resumed confirmation; confirm no registration occurs and `register` disappears from URL.
- [ ] Change capacity or eligibility before returning; confirm server reason appears, Register stays hidden, no registration occurs, and `register` disappears from URL.
- [ ] Sign in with eligible, registered, and ineligible accounts; confirm only eligible visible cards show Register and no page loads more than 20 capability checks.

## T7 about-english-translation

- [ ] Switch to English on `/about`; confirm full page content, labels, and accessible names are English.
- [ ] Switch to French on `/about`; confirm full page returns to original French meaning.
- [ ] Switch EN/FR while staying on `/about`; confirm page `lang` follows locale and names, links, images remain unchanged.
- [ ] Open About from home in EN/FR; confirm card label/description are localized and links/images still work.

## T8 power-user-event-league-gates

- [ ] Signed out plus signed in, keep Power User mode off; confirm Event/League pages and cards remain visible while every create/edit/import/restore/delete/status/move/player-rename/archetype mutation action is absent or read-only.
- [ ] With Power User mode off, confirm Full Data Export, League Export, Event ICS export, Calendar Register, public Event/League detail, result pages, participants links, and Settings remain available.
- [ ] Enable Power User mode in Settings in English plus French; reload browser and confirm preference persists while help states mode grants no server role or privilege.
- [ ] As verified Organizer plus Admin with Power User mode on, confirm Event create/edit/publish/cancel/delete and server League mutation controls return under existing role rules.
- [ ] Signed out plus plain User with Power User mode on, confirm browser-local League mutations return, server League remains read-only, and Event create/edit routes stay unavailable.
- [ ] Open `/events/new` plus organizer Event edit URLs with Power User mode off; confirm redirects to Calendar plus My Events. Confirm no Event/League mutation request reaches API or local adapter.

## T9 live-power-gates

- [ ] Signed out with existing browser-local Live Tournament plus Power User mode off; confirm list/detail remain readable while create, settings, player, round, checkpoint, finalize, and delete controls are absent.
- [ ] As Organizer with existing server Live Tournament plus Power User mode off; confirm list/detail remain readable while no Live mutation request reaches API.
- [ ] Open `/live-tournaments/new` with Power User mode off; confirm redirect to `/live-tournaments` while list/detail routes remain open.
- [ ] Enable Power User mode as anonymous visitor; confirm local create, player, round, finalize-download, and delete journeys still work.
- [ ] Enable Power User mode as Organizer plus Admin; confirm server Live create, settings, players, rounds, checkpoint, finalize/archive, and delete journeys still work under existing role rules.
- [ ] Toggle Power User mode without reloading auth/profile; confirm anonymous/User stay browser-local plus Organizer/Admin stay server-backed.

## T10 player-stats-domain-parity

- [ ] Open existing Player Statistics page; confirm Nemesis and Rival still display Player Names and their filters still work.
- [ ] Spot-check existing League and Tournament results; confirm rankings and result calculations remain unchanged.

## T11 player-page-controls-pagination

- [ ] Open Player Statistics with 120+ Matches; confirm online-only is checked, first page shows 50 Matches, and page controls show 1/3.
- [ ] Include a browser-local League; uncheck online-only and confirm metrics plus Match history update immediately, then recheck and confirm local data disappears.
- [ ] Select page sizes 10, 20, 50, and 100; confirm exact slices, bounds disable Previous/Next, and refresh preserves selected size.
- [ ] Change search, clear search, sort order, source toggle, page size, and loaded League data; confirm each returns to page 1.
- [ ] Confirm seven count cards plus five metric cards appear in specified order, percentages use two decimals, missing values show localized N/A, and archetype displays Name (N matches).
- [ ] Activate Match cards and filter tokens on later pages by pointer and keyboard; confirm Tournament navigation and filtering still work.

## T12 atomic-archive-edit-batch

- [ ] Invoke same-League edit batch against server; confirm one HTTP request returns `destinationLeague: null`, applies name/date/round/archetype intents, and bumps source version once.
- [ ] Invoke same-authority move batch against server; confirm source plus destination each bump once. Retry with stale target ETag plus invalid conflicting intents; confirm neither League changes.
- [ ] Invoke same-League plus move batches against browser-local Leagues; confirm one IndexedDB `readwrite` transaction per batch and authoritative returned rows replace caller state.
- [ ] Inject failure on second local put plus stale target version; confirm IndexedDB abort leaves both source plus target unchanged.
- [ ] Disable Power User mode, then try batch repository call; confirm rejection occurs before adapter access. Re-enable, try local↔server move; confirm rejection occurs before either port access.
- [ ] Exercise existing immediate Archive edit/move/round/entry/archetype controls; confirm they still compile and work until staged editor ships.

## T13 staged-archive-tournament-editor

- [ ] Open authorized server plus browser-local Archive Tournaments; confirm both start read-only with Edit, while Power off/plain User server pages expose no Edit control.
- [ ] Enter Edit, rename/date/move/add/import/edit/delete rounds or entries plus archetypes; confirm no API/IndexedDB mutation occurs before Save Changes and Cancel Edit restores source after confirmation.
- [ ] Save a mixed draft; confirm one final dialog lists move plus exact deleted round/entry counts, one batch commits, and moved Tournament navigates to target League.
- [ ] Force server 412 plus local stale version; confirm draft stays intact, Reload Latest cancellation keeps it, confirmation discards it after authoritative reload, and no auto-merge/retry occurs.
- [ ] Confirm League selector includes active same-authority Leagues only; local↔server targets never render.
- [ ] Compare Round plus Player Archetype chevrons visually; confirm both use same 24px inline inset with no negative offset.

## T14 global-stats-api

- [ ] `curl 'http://127.0.0.1:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=100'` against a running server with completed Leagues returns HTTP 200 with the 14 statistics fields of this ticket (`position`, `playerName`, `playedMatchCount`, `matchWins`, `matchLosses`, `matchDraws`, `matchWinrate`, `playedGameCount`, `gameWins`, `gameLosses`, `gameWinrate`, `nemesis`, `rival`, `mostPlayedArchetype`) plus pagination envelope (`page`, `pageSize`, `totalCount`, `sort`, `direction`).
- [ ] Confirm route `/api/leagues-archive/global-player-statistics` does not conflict with `/{id}`; `curl '/api/leagues-archive/some-league-id'` still returns the League detail.
- [ ] Repeat identical request with `If-None-Match` set to the first response ETag; confirm 304 Not Modified.
- [ ] Active-only and soft-deleted Leagues do not contribute players to global stats.
- [ ] Players whose only appearances are Bye entries are absent from results.
- [ ] `pageSize=20` returns HTTP 400; `sort=unknownColumn` returns HTTP 400; search longer than 200 chars returns HTTP 400.

## T15 global-stats-page-home-nav

- [ ] Visit `/global-stats` as anonymous visitor; confirm page loads with 12 column headers in order: #, Player, Rating, Tournaments, Matches, Wins, Losses, Draw, M%, Nemesis, Rival, Archetype (matches). *(updated by round-6 T6 and T16; the game columns were dropped and MW/ML/MD renamed)*
- [ ] Click a numeric header (e.g. MW); confirm table re-requests with sort=matchWins&direction=desc and Position column reflects new order.
- [ ] Click same numeric header again; confirm direction toggles to asc.
- [ ] Click Position, Player, Nemesis, Rival, or Archetype header; confirm no sort request is triggered.
- [ ] Type a player name substring in the search field and apply; confirm URL includes search param and page is reset to 1.
- [ ] Select page sizes 10, 25, 50, 100 from the dropdown; confirm correct rows returned and URL updates.
- [ ] Confirm null match/game win-rate cells show `—`, opponent cells show `Name (W-L)`, archetype cell shows `Name (N matches)`.
- [ ] Confirm non-null percentage cells show whole-number percent (e.g. 75%, not 75.00%).
- [ ] Click a Player Name link; confirm navigation to `/players/:name` for that player.
- [ ] Visit home page signed in; confirm card order is Calendar, My Registrations, Global Rankings, Leagues (archive), Live Tournaments, About, Settings (7 cards).
- [ ] Visit home page signed out; confirm card order is Calendar, Global Rankings, Leagues (archive), Live Tournaments, About, Settings (6 cards); My Registrations absent.
- [ ] Click Global Rankings home card; confirm navigation to `/global-stats`.
- [ ] Confirm home card for Live Tournaments says "Live Tournaments" (not "Running Tournaments"); Live Tournaments list page title also says "Live Tournaments".
- [ ] Confirm Live Tournaments list page create action says "Create Live Tournament".
- [ ] Confirm breadcrumb at `/global-stats` reads "Menu > Global Rankings" in English and "Menu > Classement Global" in French. *(renamed by round-6 T4)*
- [ ] Confirm breadcrumb at `/live-tournaments` reads "Menu > Live Tournaments" in English.

## T1 event-rename-routes

- [ ] Start `npm run dev`, open `http://127.0.0.1:4200/events` — the browse page (calendar + list views) renders.
- [ ] Open `http://127.0.0.1:4200/calendar` — the 404 page renders; no redirect occurs.
- [ ] Open `http://127.0.0.1:4200/calendar/tournaments/some-slug` — the 404 page renders; no redirect occurs.
- [ ] Click the home-menu calendar card — browser navigates to `/events`.
- [ ] Open the About page; click all three calendar-related buttons — each lands on `/events`.
- [ ] While signed in as a non-power-user, navigate to `/events/new` directly — guard redirects to `/events`.
- [ ] Open any event detail page — the Back buttons (top and bottom) each link back to `/events`.
- [ ] Open an event-create success screen — the "Return to menu" link navigates to `/events`.
- [ ] Check breadcrumbs at `/events`: shows `Menu / Événements` with `Menu` linking to `/`.
- [ ] Check breadcrumbs at `/events/some-slug`: shows `Menu / Événements / Event` with `Événements` linking to `/events`.

## T2 event-rename-files

- [ ] Start `npm run dev`; open `/events` — browse page renders exactly as before with calendar and list views.
- [ ] Open `/events/:slug` for an event detail — page renders correctly.
- [ ] Open `/organizer/events` (signed in as organizer) — list page renders and event create/cancel/delete actions work.
- [ ] Open `/events/new` (signed in as power-user organizer) — event create form renders.
- [ ] Open `/registrations` (signed in) — My Registrations page renders.
- [ ] Open `/admin/events/deleted` (signed in as admin) — deleted events page renders.
- [ ] Check browser DevTools Network tab: no 404 for any `features/` chunk import.
- [x] localStorage key `gones.calendar-v1.all-tournaments` renamed to `gones.events.catalog` by T3.

## T3 event-rename-identifiers

- [ ] Start `npm run dev`, open `/events` in a browser that already has `gones.calendar-v1.all-tournaments` in localStorage — the page loads from the network, writes `gones.events.catalog` to localStorage, and the old key is never read again.
- [ ] Switch language to French on `/events` and back to English — every string still resolves; no raw key is rendered.
- [ ] Check localStorage in DevTools: key `gones.events.catalog` exists; `gones.calendar-v1.all-tournaments` does not.
- [ ] Sync the event list (click Synchronise) — page refreshes data and `gones.events.catalog` is written with the view preference in `gones.events.view`.
- [ ] Open an event detail page — all strings render correctly (no raw `event.*` key visible).
- [ ] Open `/events` as a non-logged-in user — offline banner and stale indicator work if offline.

## T4 back-button-everywhere

- [ ] Sign in as `admin@gones.test` / `Gones-dev-pass-123!`. Navigate to `/admin` — confirm a back button appears above and below the admin nav; both navigate back to `/`.
- [ ] Navigate to `/admin/users` — confirm back button above and below content; clicking either takes you to `/admin`.
- [ ] Navigate to `/admin/organizations` — confirm back button above and below content; clicking either takes you to `/admin`.
- [ ] Navigate to `/admin/audit` — confirm back button above and below content; clicking either takes you to `/admin`.
- [ ] Navigate to `/admin/notifications/history` and `/admin/notifications/dead-letters` — confirm back buttons above and below; clicking either takes you to `/admin`.
- [ ] Navigate to `/admin/events/deleted` — confirm back buttons above and below; clicking either takes you to `/admin`.
- [ ] Navigate to `/global-stats` — confirm back button above and below; both navigate to `/`.
- [ ] Navigate to `/settings/account` — confirm back button above and below; clicking either uses browser history back.
- [ ] Navigate to `/organizations` (public list) — confirm back button above and below; both navigate to `/`.
- [ ] Navigate to `/organizations/:id` — confirm back button above and below; clicking either uses browser history back.
- [ ] Navigate to `/organizer/organizations` (if organizer role) — confirm back button above and below; both navigate to `/`.
- [ ] Navigate to `/organizer/events` — confirm back button above and below; clicking either uses browser history back.
- [ ] Navigate to `/events/new` — confirm back button above and below; clicking either uses browser history back.
- [ ] Navigate to `/organizer/events/:id/participants` — confirm back button above and below; clicking either uses browser history back.
- [ ] Navigate to `/login` — confirm a top back button is present and NO bottom back button is shown.
- [ ] Navigate to any result page `/leagues-archive/:id/tournaments-archive/:id/result` — confirm a top back button appears above; clicking uses browser history back. This page does not scroll and docks its own footer row, so also confirm there is NO floating "Back to previous page" button at the bottom, and that the page's own "Back to Tournament", standings/metagames and download buttons are all visible and clickable (nothing sits on top of them).
- [ ] Navigate to `/live-tournaments/new` or an existing live tournament — confirm both top and bottom back buttons exist.
- [ ] Navigate to `/players/:name` — confirm the footer back button now says "Back to previous page" and uses browser history (not the old `position="top"` footer).
- [ ] Check the home page (`/`) — confirm a top back button is rendered; confirm no broken layout.
- [ ] Open `/app-error` directly — confirm back button above and below content.

## T5 logout-return-url

- [ ] Start `npm run dev`, sign in as `test@gones.test` / `Gones-dev-pass-123!`, navigate to `/registrations`, click Logout — confirm URL is `/login?returnUrl=%2Fregistrations`.
- [ ] From that `/login?returnUrl=%2Fregistrations` page, sign in again — confirm you land back on `/registrations`.
- [ ] Open `/login` while signed out — confirm the header shows no Sign in button.
- [ ] Open `/register` while signed out — confirm the header shows no Sign in button.
- [ ] Open `/auth/complete-profile`, `/verify-email`, `/forgot-password`, `/reset-password` — confirm none show a Sign in button in the header.
- [ ] Open `/events` while signed out — confirm the header shows the Sign in button.
- [ ] Log out from `/admin/users` as an admin, then sign in as a plain User account — confirm the admin guard redirects (e.g. to `/`) instead of rendering the admin page.

## T6 home-about-polish

- [ ] Run `npm run dev`, open `http://127.0.0.1:4200/` in a fresh browser profile (or clear localStorage in DevTools). Confirm you land on `/about`.
- [ ] From `/about`, navigate to `/` (via the Menu link or address bar). Confirm the home menu renders and its Leagues archive card reads **Leagues Archive**.
- [ ] In the home menu, switch language to French. Confirm the Leagues archive card reads **Archives des ligues**.
- [ ] Navigate to `/leagues-archive`. Confirm the breadcrumb shows **Leagues Archive** (en) or **Archives des ligues** (fr).
- [ ] Reload the page while on `/`. Confirm the home menu renders immediately (no second redirect to `/about`).

## T7 cache-foundation

- [ ] Run `npm run dev`, open `/events`. Confirm the "Last sync: …" label and the Synchronise button sit at the right of the back-button row and look exactly as before (same icon, same size, same spacing).
- [ ] With DevTools Network open, reload `/events` within 24h of the first load. Confirm there is NO request to `/api/events/all`.
- [ ] Press Synchronise. Confirm exactly one request to `/api/events/all` and that the "Last sync" instant updates.
- [ ] While the Synchronise request is in flight, confirm the button is disabled.
- [ ] Switch the language to French. Confirm the button reads **Synchroniser** and the label reads **Dernière synchro : …**.
- [ ] In DevTools, go offline and reload `/events`. Confirm the cached events still render and the stale/offline banner appears (it now sits under the Synchronise button, at the top of the page).
- [ ] Sign in as `test@gones.test` / `Gones-dev-pass-123!`, then sign out. In DevTools → Application → IndexedDB, confirm the `gones-cache` database is gone.

## T8 leagues-archive-cache

- [ ] Run `npm run dev -- --env=demo`, open `/leagues-archive`. In DevTools Network, confirm a request to `/api/leagues-archive` is made and the league grid renders.
- [ ] Confirm the Synchronise button is visible directly below the page heading.
- [ ] Reload the page. Confirm NO new request to `/api/leagues-archive` (served from cache). The grid still renders.
- [ ] Press Synchronise. Confirm exactly one request to `/api/leagues-archive` and that the "Last sync" label updates.
- [ ] Enable Power User mode, create a browser-local league (any name), then reload with a fresh server cache. Confirm the local league still appears in the grid (alongside server leagues).
- [ ] Stop the API (`docker compose stop api`) and reload. Confirm the cached server list still renders and the offline banner appears under the Synchronise button. Local leagues remain visible.
- [ ] Restart the API. Press Synchronise. Confirm the offline banner disappears and the grid refreshes.

## T9 registrations-settings-cache

- [ ] Run `npm run dev -- --env=demo`, sign in as `test@gones.test` / `Gones-dev-pass-123!`, open `/registrations`. In DevTools Network, confirm a request to `/api/users/me/registrations*` is made and the list renders.
- [ ] Confirm the Synchronise button and "Last sync: …" label are visible directly under the page heading.
- [ ] Navigate away (e.g. to `/events`) then return to `/registrations`. Confirm NO new request to `/api/users/me/registrations*` (served from 24h IndexedDB cache).
- [ ] Press Synchronise. Confirm exactly one new request and that the "Last sync" instant updates.
- [ ] Sign out, sign in as `admin@gones.test`, open `/registrations`. Confirm the admin's own registrations are shown, not the previous account's. Confirm an API call was made (cache was purged on logout).
- [ ] Sign in as `admin@gones.test`, open `/settings`. Confirm the admin deck archetype panel has a Synchronise button (under the heading).
- [ ] Add or delete a deck archetype. Confirm the catalog reloads after the save (API call visible in DevTools) and the "Last sync" label updates.
- [ ] Reload `/settings` within 24h. Confirm NO new request to `/api/admin/deck-archetypes*` (served from cache).
- [ ] Sign out while on `/settings`. In DevTools → Application → IndexedDB, confirm the `gones-cache` database is gone (private cache purged on logout).

## T10 live-list-cache

- [ ] Run `npm run dev -- --env=demo`, sign in as an Organizer, open `/live-tournaments`. In DevTools Network, confirm a request to `/api/live-tournaments*` is made and the list renders.
- [ ] Confirm the Synchronise button and "Last sync: ..." label are visible directly below the page heading.
- [ ] Navigate away (e.g. to `/`) then return to `/live-tournaments`. Confirm NO new request to `/api/live-tournaments*` (served from 24h IndexedDB cache).
- [ ] Press Synchronise. Confirm exactly one new request and that the "Last sync" instant updates.
- [ ] Enable Power User mode. Create a new Live Tournament from the list -- confirm you are navigated to the runner and, on returning to the list, the new tournament appears immediately (the create invalidated the cache).
- [ ] Confirm the list cards carry no Delete button: deleting a Live Tournament stays on the runner page.
- [ ] Sign out while on `/live-tournaments`. In DevTools Application / IndexedDB, confirm the `gones-cache` database is gone (private cache purged on logout).
- [ ] Sign out entirely, open `/live-tournaments` as an anonymous visitor. Confirm the browser-local empty state renders, the Synchronise button is visible, and no `/api/live-tournaments*` request is made.

## T11 admin-cache

- [ ] Run `npm run dev -- --env=demo`, sign in as `admin@gones.test`, open `/admin/users`. In DevTools Network, confirm a request to `/api/admin/users*` is made and the user list renders.
- [ ] Confirm the Synchronise button and "Last sync: …" label are visible directly under the page heading.
- [ ] Grant the Organizer role to a user whose role is still `User` (T19 disables the button on rows that already hold it) — confirm the list refreshes immediately and the role is shown. In DevTools Network, confirm a new `/api/admin/users*` request was made (invalidation triggered a refetch).
- [ ] Navigate away then return to `/admin/users`. Confirm NO new `/api/admin/users*` request (served from 24h IndexedDB cache). The list still renders correctly.
- [ ] Paginate to page 2 then back to page 1 — each page should be served from its own cache entry (no extra requests on repeated navigation).
- [ ] Press Synchronise — confirm exactly one new `/api/admin/users*` request and the "Last sync" label updates.
- [ ] Open `/admin/organizations`. Confirm a Synchronise button and "Last sync" label appear under the heading. The org list loads and an API request is made.
- [ ] Create a new organization — confirm it appears immediately in the list (invalidation) and an API request was made.
- [ ] Navigate away then return to `/admin/organizations` — confirm NO new list request (cache served). The org still appears.
- [ ] Open `/admin/audit`. Confirm a Synchronise button appears. Navigate away and return — no new audit request (cache).
- [ ] Open `/admin/notifications/history`. Confirm a Synchronise button appears. Navigate away and return — no new history request (cache).
- [ ] Open `/admin/notifications/dead-letters`. Confirm a Synchronise button appears. Navigate away and return — no new dead-letters request (cache).
- [ ] Open the deleted events page (`/admin/deleted-events`). Confirm a Synchronise button appears. Navigate away and return — no new request (cache).
- [ ] Sign out while on any admin page. In DevTools → Application → IndexedDB, confirm the `gones-cache` database is gone (private cache purged on logout).

## T12 event-list-card-polish

- [ ] Run `npm run dev -- --env=demo`, open `/events` in calendar view, page through three months — the first column header is always **Mon** and the day numbers line up under the correct weekday.
- [ ] Switch language to French — the weekday headers read **lun. mar. mer. jeu. ven. sam. dim.** (or locale-equivalent short names), still Monday-first.
- [ ] Switch to list view; confirm each card with a venue address shows a map-pin icon and linked address text. Click the address link — Google Maps opens in a new tab and the events list page does **not** navigate.
- [ ] While still on the list: confirm a card with no venue address shows plain unlinked text (no anchor).
- [ ] Signed out, confirm a card shows **Register** to the left of **Add to Calendar**.
- [ ] Press keyboard Enter on the venue address link — Google Maps URL opens in a new tab; the card does not navigate to the event detail.

## T13 ics-inline

- [ ] Run `npm run dev -- --env=demo`, open `/events`, switch to list view.
- [ ] Click **Add to Calendar** on any card — the browser should hand the `.ics` file to the OS handler (desktop: a calendar app chooser or the calendar app opens directly; mobile: the calendar app opens). The file should **not** silently drop into the Downloads folder.
- [ ] Open the Event detail page; click **Add to Calendar** in the **Participants** header (the Event page renders no hero Add-to-Calendar anchor) — same OS-handler behaviour as above.
- [ ] Confirm `curl -sI http://127.0.0.1:5080/api/events/<slug>.ics | grep -i 'content-disposition\|content-type'` shows `inline` and `text/calendar`.
- [ ] Open DevTools → Network, click Add to Calendar — confirm the response `Content-Disposition` header starts with `inline` and still contains `filename*=<slug>.ics`.
- [ ] The organizer bulk participants CSV export still downloads silently (no chooser) — confirm the `/admin/events/<slug>/participants` download is unaffected.

## T14 event-hero-rework

- [ ] Run `npm run dev -- --env=demo`, open any `/events/{slug}` — the title line reads `<title> (N players) Starting Hour : HH:MM` with venue local time.
- [ ] With `capacity: undefined`, the title shows the "unlimited" wording in parentheses rather than `(undefined players)`.
- [ ] The kicker (organization name) above the title is a clickable link to the organization website; clicking it opens in a new tab with `rel="noopener noreferrer"`.
- [ ] If the organization has no website, the kicker is a plain `<p>` with no anchor.
- [ ] No button row (Live Tournament / Archive Tournament / Organization Website / Add to Calendar block) appears below the date/location row.
- [ ] The Event page renders no Add-to-Calendar button in the hero: the one Add-to-Calendar action lives in the **Participants** header, and it hands the `.ics` to the OS handler.
- [ ] Change system timezone or use a device in another zone — the title still shows venue local time (`Starting Hour`); the "your time" line below shows the viewer's local time.

## T15 event-organizer-row

- [ ] Run `npm run dev -- --env=demo`, open an event whose organization has two or more members — the bottom of the hero section shows a small italic comma-separated list of organizer usernames (e.g. `alice, bob`).
- [ ] Open an event whose organization has exactly one member — one username appears, no trailing comma.
- [ ] Open an event whose organization has no members (Draft organization) — no organizer line appears at all in the hero.
- [ ] The organizer line is visually the last element of the hero, appearing after the viewer-time paragraph.
- [ ] No e-mail addresses appear in the organizer row or anywhere in the event detail page outside the `contactEmail` field.

## T16 org-ownership-backend

- [ ] Run `npm run dev:env -- --env=demo`; confirm it seeds 2 organizations with no `ownerEmail` anywhere in `fixtures/dev-environments/demo/organizations.json`.
- [ ] Sign in as `admin-empty@gones.test`; `POST /api/admin/organizations` with `{"name":"No Owner Test"}` only (no `ownerUserId`) returns `201` with `memberCount: 1`, `isDraft: false`.
- [ ] `GET /api/organizations/{id}/members` for that organization lists the calling admin once, with `"role": "Organizer"`.
- [ ] Repeat the create with a stray `"ownerUserId"` in the body — it still returns `201` and the named account gets no membership row.
- [ ] `POST /api/organizations/{id}/transfer-ownership` returns `404` for any caller: the route no longer exists.
- [ ] Add a second member, sign in as that second member, and confirm they can `GET /api/organizations/{id}/members` and `PUT /api/organizations/{id}/notification-settings` — capabilities that used to answer only the Owner.
- [ ] As that second member, `DELETE /api/organizations/{id}/members/{firstMemberId}` returns `204`: no member is protected any more.
- [ ] `GET /api/admin/users/{id}/closure-impact` carries no `soleOwnedOrganizations` and no `suggestedNewOwnerUserId`; `blockReason` is `null` for a closable account.
- [ ] `POST /api/admin/users/{id}/disable` with only `{"confirmedUsername": "..."}` (no `ownershipTransfers`) returns `204` for the sole member of an organization.
- [ ] After that closure, the organization still exists and reads `memberCount: 0`, `isDraft: true` in `GET /api/admin/organizations?search=...`.
- [ ] Closing yourself still returns `409`, and closing the last remaining Admin still returns `409`.
- [ ] On a database seeded before this change, confirm `organization_members` has no row left with `role = 'Owner'` after the `RemoveOrganizationOwnership` migration runs.

## T17 org-ownership-frontend

- [ ] Run `npm run dev -- --env=demo` and sign in as `admin@gones.test`.
- [ ] Open `/admin/organizations`; type in the search box and confirm the list narrows on its own after a short pause, without pressing anything — there is no Apply button.
- [ ] Type three characters quickly and confirm the URL updates once, to the full term, not once per keystroke.
- [ ] Confirm the New Organization button now sits **below** the search block and is warning-coloured.
- [ ] Click New Organization: the form has a Name, Description, Website and Contact email field and **no** Owner User ID field.
- [ ] With the name empty, confirm an inline "Name is required." message under the field and a disabled Create button; no request is sent.
- [ ] Type `not a url` into Website: an inline message names the website field and Create stays disabled. Replace it with `https://example.com` and the message clears.
- [ ] Type `nope` into Contact email: an inline message names the contact e-mail field and Create stays disabled. Replace it with `club@example.com` and the message clears.
- [ ] Fill only the Name and submit: the organization is created and appears in the list with the signed-in admin as its single member.
- [ ] Re-open the form, type a name, click Cancel: the form closes; re-opening it shows an empty name.
- [ ] Open `/organizations` directly: the 404 page renders (the public list route is gone).
- [ ] Open `/admin`: there is no second Organizations button next to the admin nav links.
- [ ] Open `/organizations/{id}` for an organization you belong to: the detail page renders and its in-page back link goes to `/organizer/organizations`.
- [ ] On that page, the roster shows each member's role as plain text `Organizer` — no role dropdown, and no way to promote anyone to Owner.
- [ ] As an Admin on the same page, the Add member form has a User ID field and no role dropdown.
- [ ] Sign in as a non-creating member of an organization and open `/organizer/organizations`: the card action reads **Manage** (not View) and opens the detail page.
- [ ] As that member, open `/settings`: the organization notification preferences section lists **every** organization you belong to, and saving one shows the confirmation.
- [ ] Open `/admin/users`, click Disable account on a user who belongs to an organization: the impact line reports only the membership count, there are no per-organization transfer inputs, and disabling with just the typed username succeeds.

## T18 admin-breadcrumb-cards

- [ ] Run `npm run dev -- --env=demo` and sign in as `admin@gones.test`.
- [ ] Open `/admin`: the breadcrumb reads `Admin console` alone (no `Menu` crumb), and the page shows six cards laid out in a grid like the home menu.
- [ ] Each card has a title and a short description.
- [ ] Click each card and confirm: the breadcrumb reads `Admin console / <page name>` and clicking `Admin console` navigates back to `/admin`.
- [ ] Confirm that no admin page (`/admin/users`, `/admin/organizations`, `/admin/audit`, `/admin/notifications/history`, `/admin/notifications/dead-letters`, `/admin/events/deleted`) shows `Menu` or `Page not found` in its breadcrumb.

## T19 admin-role-guards

- [ ] Run `npm run dev -- --env=demo` and sign in as `admin@gones.test`. Open `/admin/users` and find your own row.
- [ ] On your own row, Revoke Admin is greyed out and cannot be clicked; hovering it shows "You cannot revoke your own Admin role."
- [ ] On your own row, Disable account is greyed out and cannot be clicked; hovering it shows "You cannot disable your own account." No disable dialog opens.
- [ ] On your own row, both Grant Organizer and Grant Admin are greyed out, since an Admin already holds both.
- [ ] On a row whose role is `Organizer`, Grant Organizer is greyed out and hovering it shows "This account already has this role."; Grant Admin stays clickable.
- [ ] On a row whose role is `Admin` (not yours), Grant Organizer is greyed out and hovering it shows "Admin already includes Organizer."; Grant Admin is greyed out too.
- [ ] On a row whose role is `User`, both Grant buttons are clickable and granting still works end to end.
- [ ] With DevTools Network open, hover and try to click every greyed-out button above: no request leaves the browser.
- [ ] Switch the language to French and re-check the same rows: each greyed-out button shows the French explanation, none is blank.
- [ ] On another admin's row (not yours), Revoke Admin and Disable account stay clickable — the block is about yourself, not about the Admin role.

## T20 tournament-completion-flag

The Archive Tournament now carries a `status` of `active` or `completed`. T21 adds the visible badge
and toggle — check T21 for all visual coverage. These T20 steps verify the flag is carried correctly
in data exports and restores, and that the app behaves exactly as before at the data layer.

- [ ] Run `npm run dev -- --env=demo` and sign in as `organizer-gones-one-registration@gones.test`, Power User mode on.
- [ ] Open `/leagues-archive` and confirm the list and each League detail page look exactly as before — no new badge, chip, column or control anywhere on a Tournament.
- [ ] Open `Gones League 6` and export it (League Export). Open the downloaded JSON: every object under `league.tournaments` has `"status": "completed"` — three of them, since the demo Archive predates the field.
- [ ] Restore that same file (Full Data / League restore). Open the restored League's export: every tournament still reads `"status": "completed"`. No tournament flipped to `active`.
- [ ] In the restored League, create a new Archive Tournament, then export the League again: the new tournament reads `"status": "active"` while the restored ones stay `"completed"`.
- [ ] Rename that new tournament and change its date, then export again: it still reads `"status": "active"` — an ordinary edit does not change the status.
- [ ] Move the new tournament to another League, then export the destination League: it still reads `"status": "active"`.
- [ ] Take an old League export made before this change (or hand-edit one to delete every `"status"` line under `tournaments`) and restore it: every tournament comes back as `"completed"`, and the League's own status is unchanged.
- [ ] Finish a running tournament from `/live-tournaments` through to its Archive, then export the target League: the finalized tournament reads `"status": "active"`.
- [ ] Repeat the create / edit / export / restore checks in browser-local mode (signed out, Power User mode on): the same statuses appear in the exported JSON.
- [ ] Open a League Result and a Tournament Result page and confirm the standings, warnings and Player Statistics are identical to before — the per-Tournament field does not change those pages. (Since T22 it *does* scope the global Player Rankings; see the T22 section.)

## T21 tournament-completion-ui

- [ ] Run `npm run dev -- --env=demo`, sign in as `organizer-gones-one-registration@gones.test`, enable Power User mode in Settings.
- [ ] Open a League from `/leagues-archive` **whose own status is Active**, open an Archive Tournament. Confirm a status badge is visible near the top of the heading block — it should read **Completed** (backfilled by T20 for demo data). Inside a completed League no toggle is offered at all — see Post-review frontend fixes.
- [ ] Confirm a **Reopen** button is visible in the action row (top-right area). Click it and confirm a confirmation dialog appears; dismiss with Cancel — confirm no change occurs and the badge still reads Completed.
- [ ] Click **Reopen** again and confirm in the dialog. Confirm the badge changes to **Active** and the button changes to **Mark complete** — without a page reload.
- [ ] Reload the page. Confirm the badge still reads **Active** (persisted through reload).
- [ ] Click **Mark complete**, confirm in the dialog. Confirm the badge returns to **Completed**.
- [ ] Turn Power User mode OFF (Settings). Return to the same Archive Tournament — confirm the badge is still visible but the **Mark complete / Reopen** button is absent.
- [ ] Sign out. Open the same Archive Tournament URL. Confirm the badge is still visible and no toggle button appears.
- [ ] Open the League detail page. Confirm each Tournament card in the list shows a small status badge (Active or Completed) matching the tournament's status.
- [ ] Repeat the mark-complete and reopen flow in browser-local mode (signed out, Power User mode on, using a league created in this browser): confirm the toggle and badge work the same way.
- [ ] Sign in as a plain `User` (not Organizer or Admin). Open a server League's Archive Tournament — confirm the badge shows but the toggle is absent.

## T22 player-statistics-read-model

Player statistics are now materialized in the `player_statistics` table, rewritten inside every archive
write transaction and rebuilt at startup when the formula version changes. No page reads the table yet
(T23/T25 do), so the visible app must be unchanged — with one real behaviour change: the global
statistics are now scoped to **completed Archive Tournaments** instead of completed Leagues.

Run `npm run dev -- --env=demo` and sign in as `organizer-gones-one-registration@gones.test` with Power
User mode on. Read the table with:
`docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select count(*) from player_statistics;'`

- [ ] Right after the stack is up, the table already has rows — the startup rebuild ran before the API served traffic. `docker compose logs api | grep 'Player statistics rebuilt'` shows a row count and a duration, and that line appears *before* `Now listening on`.
- [ ] `select * from player_statistics_meta;` returns exactly one row, with `formula_version` = 1 and a `rebuilt_at` from this start.
- [ ] Browse the app as before — home, `/leagues-archive`, a League, an Archive Tournament, a player page, the global Player Rankings page. Nothing looks different from before this change.
- [ ] Open an Archive Tournament of the **completed** demo League and click **Reopen**. The global Player Rankings page drops that tournament's matches from every player's totals, and players who only ever played there disappear from the list.
- [ ] Click **Mark complete** on the same tournament. The Player Rankings numbers return to exactly what they were before the reopen, with no reload of the API and no waiting.
- [ ] Repeat the reopen/complete on a tournament of the **active** demo League (`Gones League 7`). The row count in `player_statistics` moves both times — a completed Tournament counts even though its League is still active.
- [ ] Delete a League from `/leagues-archive`. The `player_statistics` count drops, and players who only appeared in that League have no row left.
- [ ] Restore that League from its export (Full Data / League restore). The count returns and the restored players are back.
- [ ] Rename a player through the admin player-name maintenance screen. The old name has no row in `player_statistics`; the new name has one carrying the merged totals.
- [ ] Stop the stack, run `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'update player_statistics_meta set formula_version = 0;'`, then `docker compose restart api`. The logs show `Rebuilding player statistics: stored formula version 0 is not 1.` followed by a rebuild line, and the meta row is back at 1.
- [ ] Restart the API with `GONES_PLAYER_STATISTICS__REBUILD_ON_STARTUP=false` after setting `formula_version = 0` again. The logs say the startup rebuild is disabled, the table is left exactly as it was, and the meta row still reads 0.
- [ ] With the switch back on, corrupt one archive row by hand (`update league_archive_aggregates set canonical_document = jsonb_set(canonical_document, '{tournaments,0,leagueId}', '"nope"') where ...`) and restart the API. It logs `Player statistics startup rebuild failed; the stored formula version is left unchanged.` and still reaches `Now listening on` — the API must not crash-loop.
- [ ] In browser-local mode (signed out, Power User mode on), the app behaves exactly as before: the table is server-side only and browser-local data never reaches it.

## T23 rankings-endpoints

The rankings endpoints now read `player_statistics` instead of recomputing from League documents, and a
full-catalog endpoint was added. The league-level `status = 'completed'` pre-filter is **gone**: a
completed Archive Tournament counts even when its League is still active. On the demo dataset this
raises the roster from 30 to 35 players and changes the totals of 8 shared players — that is the
intended correction, not a regression.

Run `npm run dev -- --env=demo`.

- [ ] Open the global Player Rankings page. It lists **35** demo players, including `Demo Player 31`–`Demo Player 35`, who play only in the active League `Gones League 7`.
- [ ] `Demo Player 06` shows **7** played matches (it showed 5 before this change), and `Demo Player 18` shows `Demo Player 11` as its Rival.
- [ ] Page through the list at each page size (10, 25, 50, 100). No player appears on two pages, and the total stays 35. An out-of-range page size is refused rather than silently clamped.
- [ ] Sort by each sortable column in both directions. The order matches the numbers shown, and the rank numbering stays continuous across pages.
- [ ] Type a search term. The list narrows as expected and the total updates with it.
- [ ] `curl -s -D- 'http://127.0.0.1:5080/api/leagues-archive/global-player-statistics/all' -o /dev/null` returns `200` with `Cache-Control: public, max-age=3600` and an `ETag`. Repeat the request with `If-None-Match: "<that etag>"` → `304`, no body. (Use `-D-` with GET; `curl -I` sends HEAD, which this route does not map.)
- [ ] Reopen an Archive Tournament, then reload the rankings: the affected players' numbers change immediately and the ETag differs from the one before the write. Mark it complete again and the previous numbers and ETag return.

## T24 rankings-page

The global Rankings page now fetches the full catalog once (`/all` endpoint), caches it in
`localStorage` for 24 h, and filters / sorts / pages entirely in the browser.

Run `npm run dev -- --env=demo`.

- [ ] Open `/global-stats`. Exactly one request to `/api/leagues-archive/global-player-statistics/all` appears in the Network tab. The page shows all 35 demo players.
- [ ] Type a search term in the filter field. The table narrows **as you type** with no new network request. The position numbers restart from 1 for the filtered set.
- [ ] Click any sortable column header. The table re-sorts instantly with no new network request; clicking again reverses the order.
- [ ] Change the page size or click Previous/Next. Rows change instantly with no new network request.
- [ ] Reload the page (F5). No new network request fires (served from `localStorage` cache). The "last synced" label matches the previous visit time.
- [ ] Click the **Synchronize** button. Exactly one new request to `/all` is made and the "last synced" label updates.
- [ ] Switch the app language to French (Settings). The page title reads **Classement Global** (not "Classement mondial"), and there is clear space between the title and the filter input.
- [ ] Both the top and bottom **back** buttons navigate away from the page.
- [ ] The **Apply** button is gone; there is no button to explicitly submit the search.

## T25 player-endpoints

A new anonymous `GET /api/players/{playerName}` returns one player's statistics — read straight from
the `player_statistics` read model, so it agrees with the Rankings page by construction — plus a flat
match history that carries ids and names instead of whole League and Tournament documents. Nothing in
the UI consumes it yet; the player page still computes locally until T26.

Run `npm run dev -- --env=demo`.

- [ ] `curl -s 'http://127.0.0.1:5080/api/players/Demo%20Player%2006' | jq '.statistics'` returns `playedMatchCount 7`, `matchWins 5`, `matchLosses 2`, `gameWins 12`, `gameLosses 5`, Nemesis and Rival both `Demo Player 04`, most-played archetype `Death and Taxes (White)` ×5 — the same numbers the Rankings page shows for that player.
- [ ] `… | jq '.matches | length'` returns `7`, `.totalMatchCount` returns `7` and `.truncated` is `false`.
- [ ] `… | jq '.matches[0]'` has only flat fields — `kind`, `leagueId`, `leagueName`, `tournamentId`, `tournamentName`, `tournamentDate`, `roundIndex`, `opponentName`, `ownScore`, `opponentScore`, `ownArchetype`, `opponentArchetype`. No nested `league`, `tournament` or `rounds` object anywhere in the response.
- [ ] Every entry has both archetype fields present as strings. An archetype nobody recorded is `""`, never `null` — `… | jq '[.matches[] | select(.ownArchetype == null or .opponentArchetype == null)] | length'` returns `0`.
- [ ] The history is newest first: `… | jq -r '.matches[] | "\(.tournamentDate) r\(.roundIndex)"'` descends by date, then by round within a date.
- [ ] `Gones League 7` is an **active** League with a completed `Day 1`; its matches appear in the history. A completed Tournament counts whatever its League's own status says.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5080/api/players/nobody'` returns `404`. So does any player who has never played a match in a completed Archive Tournament.
- [ ] `curl -s 'http://127.0.0.1:5080/api/players/demo%20player%2006' | jq -r '.statistics.playerName'` returns the canonical `Demo Player 06`: the lookup is case-insensitive and answers with the stored spelling.
- [ ] A name longer than 200 characters returns `400`, not `404`.
- [ ] `curl -s -D- 'http://127.0.0.1:5080/api/players/Demo%20Player%2006' -o /dev/null` returns `200` with `Cache-Control: public, max-age=3600` and an `ETag`. Repeat with `If-None-Match: "<that etag>"` → `304`, no body. (Use `-D-` with GET; `curl -I` sends HEAD, which this route does not map.)
- [ ] Reopen an Archive Tournament that player played in, then request the endpoint again: the numbers and the history shrink accordingly and the ETag differs. Mark it complete again and both return.
- [ ] The request carries no auth header and still succeeds — the endpoint is anonymous.
- [ ] Open the player page in the app for the same player. Since T26 it reads this endpoint, so its numbers are exactly the ones above, and its filter, sort, paging and highlight controls all still work.

## T26 player-page-server-stats

The player page no longer downloads every League to the browser: it reads `GET /api/players/{playerName}`,
caches the payload in `localStorage` for 24 h under `gones.player.<name>`, and only merges this
browser's own leagues into the totals and the history when **Only use online data** is off.

Run `npm run dev -- --env=demo`.

- [ ] Open `/global-stats`, search `Demo Player 06` and click the name. The player page shows Matches Played **7**, Match Wins **5**, Match Losses **2**, Match Draws **0**, Games Played **17**, Game Wins **12**, Game Losses **5**, Match Win Rate **71.43%**, Game Win Rate **70.59%**, Nemesis and Rival both **Demo Player 04**, Most Played Archetype **Death and Taxes (White) (5 matches)** — the same numbers as that player's Rankings row.
- [ ] With the Network tab open on that first load: exactly **one** request to `/api/players/Demo%20Player%2006`, and **no** `/api/leagues-archive` document downloads at all.
- [ ] Navigate away with the top back button and open the same player again. **No** new `/api/players/` request is made and the "last synced" label still shows the earlier time (the 24 h cache answers).
- [ ] Press **Synchronize**. Exactly one new `/api/players/` request is made and the "last synced" label updates.
- [ ] `localStorage` holds one key per player: open a second player and check `gones.player.demo player 06` and `gones.player.<the other name>` both exist under Application → Local Storage.
- [ ] Open `/players/Nobody%20At%20All`. The page renders the empty state (**No Matches.**, every count `0`, rates `N/A`) and shows no error banner — an unknown player and a player with no completed match are one answer.
- [ ] Every match control still works on the server data: click any date / league / tournament / round / opponent / result token to filter, the matching text is highlighted, **Clear** restores the full list, the order toggle flips between **Newest first** and **Oldest first**, the matches-per-page select and Previous/Next page through, and clicking a match card opens `/leagues-archive/{leagueId}/tournaments-archive/{tournamentId}?round=N` on the right round.
- [ ] Nemesis and Rival are still tinted in the match list, and the Nemesis / Rival cards still filter the list when clicked.
- [ ] As a Power User with a browser-local league (Settings → power user, then create a League while signed out, record a match for a player who also exists on the server, **and mark that Tournament complete** — statistics count completed Archive Tournaments only): on that player's page with **Only use online data** checked, only the server matches are listed and the totals are the server's. Uncheck it → the totals grow by exactly the local matches, the local rows appear carrying a **This browser** badge, and no server match is counted twice. Check it again → the local rows and their contribution disappear.
- [ ] With **Only use online data** off, Match Win Rate and Game Win Rate are recomputed from the merged counts (not an average of two rates), and Nemesis / Rival / Most Played Archetype are recomputed over the merged history.
- [ ] Both the top and bottom **back** buttons still leave the page, and the scroll-to-top button still works.

## T27 player-stat-grid

The player stat grid is now three rows of 5, 5 and 3 cells, and carries a new Match Draw Percentage
tile (`matchDraws / playedMatchCount`, `N/A` when the player has no matches).

Run `npm run dev -- --env=demo` and open a player page (`Demo Player 06` is a good one: 7 matches,
5-2-0, 17 games 12-5).

- [ ] The grid shows three rows with exactly 5, 5 and 3 cells, in the order the ticket specifies.
- [ ] Row 2 position 5 is Match Draw Percentage. For `Demo Player 06` (0 draws of 7) it reads `0%`; find or make a player with a draw and confirm the value equals draws ÷ matches.
- [ ] Open a player with no played matches (or a fresh browser-local one) — the draw percentage reads `N/A`, not `0%` or a blank cell.
- [ ] The draw tile is plain: it is not tinted by the win-rate colour scale that the winrate cells use.
- [ ] Resize the window below 1100 px and again below 640 px. The rows reflow without cells overlapping, clipping or spilling out of their cards.
- [ ] Click the Nemesis cell, then the Rival cell. Each still filters the match list below to that opponent, and clearing the filter restores the full list.
- [ ] Toggle Online-only off with a browser-local league present. The grid still renders 5/5/3 and the numbers include the local matches.

## T28 match-card-archetypes

Each match card now shows the archetype matchup (`{own} vs {opponent}`) immediately after the score,
with the player's archetype in cyan and the opponent's in red. An empty archetype renders
`Archetype manquant` (fr) / `Missing archetype` (en) in the same colour.

Run `npm run dev -- --env=demo` (French or English) and open a player page (`Demo Player 06` has 7
matches; most-played archetype is `Death and Taxes (White)`, and at least one row has an empty
`ownArchetype` so the placeholder branch is reachable).

- [ ] Every match card shows the archetype pair right after the score, formatted `{own} vs {opponent}`.
- [ ] The player's archetype token is cyan (`oklch(80% 0.12 200)`); the opponent's is red (same shade as Nemesis).
- [ ] The `vs` separator between archetypes is muted/dim and lowercase.
- [ ] A match whose `ownArchetype` is empty renders `Archetype manquant` (fr) / `Missing archetype` (en) in cyan; a match with an empty `opponentArchetype` renders the placeholder in red.
- [ ] Switch language to English. The placeholder reads `Missing archetype`.
- [ ] A bye row shows only the player's archetype token with no `vs` separator and no opponent archetype.
- [ ] Click any archetype token → the filter input is set and the match list narrows to cards containing that archetype; the matching text is highlighted. Clicking **Clear** restores the full list.
- [ ] Searching for an archetype name in the filter input matches the card (filtering works via `matchSearchText`).
- [ ] The existing `VS` separator between result pill and opponent name is still there; it is distinct from the new lowercase `vs` between archetypes.
- [ ] Both top and bottom back buttons, order toggle, pagination, and match-card navigation to the tournament are unaffected.

## T29 stress-dataset

A hundredfold `demo`, so every page can be judged under real weight: ~700 accounts, 200
organizations, 400 formats, 1600 Events, 700 registrations, 200 League Archives (400 Archive
Tournaments, ~1200 distinct player names, one player with 536 matches), 10 running tournaments and
10 000 generated audit rows. The dataset is generated, not committed.

```bash
npm run dev:stress:generate -- --seed=1   # writes fixtures/dev-environments/stress/*.json (gitignored)
npm run dev -- --env=stress               # resets the stack and loads them (~75 s on a warm image)
```

Accounts are `stress-admin-000@gones.test`, `stress-organizer-000@gones.test`,
`stress-user-000@gones.test` … all with the usual `Gones-dev-pass-123!`. The last hundred `stress-user-*`
accounts are deliberately unverified.

- [ ] `npm run dev:stress:generate -- --seed=1` twice in a row leaves identical files (`sha256sum fixtures/dev-environments/stress/*.json` matches); `--seed=2` changes them.
- [ ] `git status` stays clean after generating: only `environment.json` is tracked under `fixtures/dev-environments/stress/`.
- [ ] The seed prints the volumes and ends with `Player statistics rebuilt: … rows`, and the count is non-zero.
- [ ] `/events` calendar view with ~1600 Events — month cells overflow gracefully and the "+N more" indicator behaves; switching months stays responsive.
- [ ] `/events` list view — paging, the format filter (400 entries) and the city/text search all still answer quickly.
- [ ] `/global-stats` with ~1183 ranked players — the catalog loads once, filtering and sorting stay instant, and paging does not refetch.
- [ ] A heavy player's page (`Alix Aubert`, 536 matches) — the flat history renders, filters and pages without stalling; the 5/5/3 stat grid and the archetype matchups are intact.
- [ ] `/admin/users` with 700 accounts — the pager works, each page is cached under its own key, and search narrows the list.
- [ ] `/admin/audit` — the audit list pages through the generated rows and its filters answer.
- [ ] `/leagues-archive` with 200 Leagues — the grid and the cached list hold up; opening a League shows its Archive Tournaments and a League Result.
- [ ] `/live-tournaments` shows the 10 running tournaments; one of them is caught mid-round.
- [ ] Top and bottom back buttons still work on every page above.
- [ ] Reseed `demo` afterwards (`npm run dev:env -- --env=demo`) and confirm the player statistics count falls back to 35.

## T30 agent-rules-and-docs

Documentation-only ticket. Read and confirm:

- [ ] Open `AGENT.md` end to end. The three new rules ("Every page that reads server data joins the cache contract", "Every routed page carries a back button", "Logging out returns to sign-in") are present under "Rules for agents" and are unambiguous to a reader with no prior context.
- [ ] The "four newest ADRs" paragraph in `AGENT.md` names 0038, 0039, 0040 and 0041 and gives a one-line summary of each binding.
- [ ] The "What Gones is" paragraph in `AGENT.md` says "browse at `/events`" (not `/calendar`).
- [ ] Open `docs/adr/0038-event-routes-without-calendar-aliases.md`. Confirm it has a `## Status` section, says "Accepted", explicitly supersedes the permanent-frontend-redirect clause of ADR 0035, and names the routes that are not affected.
- [ ] Open `docs/adr/0039-ttl-cache-contract.md`. Confirm it names `readCached`, `invalidate`, `invalidateFamily` and `gones-sync-bar`, and states that private rows never reach `localStorage`.
- [ ] Open `docs/adr/0040-player-statistics-read-model.md`. Confirm it describes the `player_statistics` table, the transactional rebuild, `PlayerStatisticsFormula.Version`, and includes measured rebuild durations.
- [ ] Open `docs/adr/0041-organizations-without-owners.md`. Confirm it describes the single `Organizer` role, removal of `ownerUserId` and the transfer endpoint, and account-closure behaviour.
- [ ] `docs/CONTEXT.md`: "Event" entry says "browsed at `/events`"; "Organization" entry describes flat membership with a single Organizer role; "Global Player Statistics" entry says "completed Archive Tournaments" and references ADR 0040.
- [ ] `docs/GLOSSARY.md`: `calendar` entry points to `src/app/features/events/public-event-list.component.ts` and says "browse route `/events`"; new entries for `sync bar`, `catalog cache`, `read model` and `stress environment` are present.
- [ ] `docs/event-data-flow.html` exists and describes the event catalog cache flow with `/events` throughout; `docs/calendar-data-flow.html` is gone.
- [ ] `docs/sanitizer-migration-report.md`: both path references say `src/app/features/events/` (not `features/calendar/`).
- [ ] `ops/acceptance-matrix.json` has rows for the cache contract, back-button coverage, logout return contract, player statistics read model and ownership removal — each with evidence resolving to a committed gate.

## Post-review backend fixes

Four accepted backend findings from the branch review. The mail steps need a mail path you can read
(`npm run dev` with the Brevo sandbox, or read `notification_outbox.template_model_json` directly).

- [ ] Register for an Event as a signed-in user, then open the registration-confirmation mail: the link is `https://<origin>/events/<slug>` and clicking it lands on the Event page, not the 404 page.
- [ ] Unregister from that Event and confirm the unregistration mail carries the same `/events/<slug>` link.
- [ ] As the organizer, make a major update to a published Event and then cancel it; both mails link to `/events/<slug>`.
- [ ] Let a reminder fall due (or move the clock in the worker) and confirm the reminder mail links to `/events/<slug>`.
- [ ] Reject an Event proposal from the review link and confirm the "view the calendar" link in the mail is `https://<origin>/events` and opens the Event list.
- [ ] Grep the running API image for the dead route: no outbound mail body contains `/calendar/tournaments/` or a bare `/calendar` link.
- [ ] Run a migration import against a database that already has a rebuilt `player_statistics`, then confirm `SELECT count(*) FROM player_statistics_meta;` is 0 immediately after, and that the next API start logs `Player statistics rebuilt: … rows` and the imported players appear in `/global-stats` and on their `/players/<name>` page.
- [ ] While the API is up but before that restart, confirm `/api/leagues-archive/global-stats` no longer answers `304` against the ETag captured before the import.
- [ ] Edit two different Leagues at the same moment (two browser tabs, both saving an Archive Tournament) — both saves succeed; neither returns a 500 and `player_statistics` holds exactly one row per player afterwards.
- [ ] Signed in, hammer `GET /api/players/<name>` past 120 requests in a minute (vary the name so the ETag misses): the API answers `429` with `rate_limited` and a `Retry-After` header, the same as when signed out.

## Post-review frontend fixes

The accepted frontend findings from the branch review that have observable behaviour — the sixth,
the `localStorage` boundary allowlist, is test-only. The cache steps all need DevTools open on the
Network tab; 24 h is the TTL these steps prove is no longer allowed to hide a self-inflicted write
(ADR 0039).

- [ ] Run `npm run dev -- --env=demo`, sign in as an Organizer, open `/live-tournaments` (cache warms), open a Live Tournament, finalize it into a League, then return to `/live-tournaments`: the finalized tournament is gone from the list and a `/api/live-tournaments*` request was made. Repeat with **Delete** from the runner's advanced settings — the deleted tournament is gone immediately too.
- [ ] Finalize a Live Tournament into a League, then open `/leagues-archive`: the resulting Archive Tournament is counted on its League card without pressing Synchronize.
- [ ] Signed in as `test@gones.test`, open `/registrations` (cache warms), open an Event you are not registered for and press **Register**, then return to `/registrations`: the new registration is listed and a `/api/users/me/registrations*` request was made. Unregister from it and return again — the attempt shows as cancelled, still without pressing Synchronize.
- [ ] Enable Power User mode, open `/leagues-archive` (cache warms), create a League, then return to `/leagues-archive`: the new League is in the grid immediately. Repeat for renaming a League, deleting a League from the header menu, and deleting an Archive Tournament from the header menu.
- [ ] Signed out with Power User mode on, create a browser-local League and an Archive Tournament in it, record a match for a player who also exists on the server, and leave that Tournament **Active**. Open that player's page and untick **Only use online data**: the counts, Nemesis, Rival, Most Played Archetype and the match list are unchanged from the online-only view — an active Tournament counts nowhere, exactly as on the server.
- [ ] Mark that same browser-local Tournament **complete**, reload the player page and untick **Only use online data** again: now the local match is counted and its card carries the **This browser** badge.
- [ ] Open any `/events/<slug>` and click **Add to Calendar** in the Participants header: the browser hands the `.ics` to the OS calendar handler instead of dropping it in Downloads.
- [ ] Open an Archive Tournament inside a League whose status is **Completed** (mark a League complete first if the demo data has none): no **Mark complete / Reopen** button is rendered, matching the **Edit** button that is already hidden there.
- [ ] Open the same Archive Tournament inside an **Active** League: the toggle is back and still works.
- [ ] ~~Open `/global-stats` with no `?sort=` in the URL: position 1 is the player with the most Match Wins, ties broken by Game Wins, then Match Draws, then name A→Z.~~ *Superseded by T16: default order is now three-bucket by Glicko-2 rating; see T16 checklist.*
- [ ] Sort by **Game Win Rate** ascending, then descending: a player whose only matches are 0–0 draws (no winrate, shown `N/A`) is listed **last** in both directions, never first.
- [ ] Sort by any column and find two rows with the same value: their names read A→Z in both the ascending and the descending view.

---

# Round 6 — app-wide feedback (T1–T21)

Ticket numbers restart per round, so the `## T…` headings below are round 6's and are unrelated to
the identically numbered sections above. Round 6 shipped the header and breadcrumb fixes, the Home /
Global Rankings / Events copy and layout changes, the slim League Archive catalog, response
compression, and the Glicko-2 player rating.

## T1 header-actions-right-aligned

- [ ] Set browser width to 700px (e.g. DevTools responsive mode) and visit `/`: the **Sign in** button hugs the right edge of the header toolbar.
- [ ] Same at 640px: the Sign in button still right-aligned.
- [ ] Sign in (or use DevTools to mock a session), then resize to 700px: the username link and **Logout** button remain at the right edge.
- [ ] Visit `/settings` at 700px: the **Export Settings** and **Import Settings** buttons appear in the header, and the auth block (Sign in / username / Logout) is still right-most.
- [ ] Slowly drag the browser window from 800px → 600px → 400px: the auth block stays right-aligned throughout without jumping to the left at any intermediate width.

## T2 back-button-breadcrumb-root

- [ ] Visit `/` (menu page): confirm **no** back button appears at the top or bottom of the page.
- [ ] Visit `/admin` (admin home): confirm **no** back button appears at the top or bottom of the page.
- [ ] Visit `/settings`: confirm a back button appears at the **top** and at the **bottom**.
- [ ] Visit `/events`: confirm a back button appears at the **top** and at the **bottom**.
- [ ] Visit `/global-stats`: confirm a back button appears at the **top** and at the **bottom**.
- [ ] Sign out and visit `/login`: confirm the auth-exception rule holds — top back button present, no bottom back button.
- [ ] Navigate from `/settings` → click the top back button → lands on a previous page or `/`.
- [ ] Navigate from `/events` → click the bottom back button → lands on a previous page or `/`.

## T3 breadcrumb-language-refresh

- [ ] Visit `/settings` (English language set). Confirm the breadcrumb reads **Menu / Settings**.
- [ ] Without reloading, open the language selector on the Settings page and switch to **Français**. Confirm the breadcrumb immediately updates to **Menu / Paramètres** without any page reload or navigation.
- [ ] Switch back to **English**. Confirm the breadcrumb immediately reads **Menu / Settings** again.
- [ ] Navigate to `/` (menu), confirm breadcrumb reads **Menu** in both languages.
- [ ] Navigate to `/leagues-archive`, switch to French, confirm breadcrumb reads **Menu / Archives des ligues** without reloading.
- [ ] Navigate to a league detail page, switch languages, confirm the breadcrumb's league name persists and the parent crumbs translate.

## T4 home-copy-global-rankings-events

- [ ] Navigate to `/` in **English** — confirm the calendar card title reads **Events** (not Calendar).
- [ ] Navigate to `/` in **Français** — confirm the calendar card title reads **Événements** (not Calendrier).
- [ ] Navigate to `/` in **Français** — confirm the global rankings card title reads **Classement Global** (not Classement mondial).
- [ ] Navigate to `/` in **Français** — confirm the global rankings card description starts with **Classement global des joueurs** (lowercase 'g', not Classement mondial).
- [ ] Navigate to `/global-stats` in **Français** — confirm the breadcrumb second segment reads **Classement Global** (not Classement mondial).
- [ ] Navigate to `/global-stats` in **Français** and inspect the table element — its `aria-label` reads **Tableau du classement global des joueurs** (not "classement mondial"). *(added by T20)*
- [ ] Navigate to `/global-stats` in **Français** with more rows than one page — the pagination `<nav>` `aria-label` reads **Pages du classement global**. *(added by T20)*
- [ ] Stop the API (`docker compose stop api`) and reload `/global-stats` in **Français** with no cached copy — the error line reads **Impossible de charger les statistiques globales.** (not "mondiales"). *(added by T20)*
- [ ] Navigate to `/events` — confirm the breadcrumb still reads **Calendar** (en) / **Calendrier** (fr), unchanged.
- [ ] Confirm `data-cy="menu-calendar-card-title"` still exists on the events card (hook is stable).

## T5 global-rankings-heading-row

- [ ] Open `/global-stats` at viewport width ≥ 1024px. Confirm the page title ("Global Rankings" / "Classement Global") and the Synchronise button appear on the **same horizontal row**, title on the left, button on the right.
- [ ] Resize the browser below 600px (or use DevTools device toolbar). Confirm the title is on its own line and the Synchronise bar appears **below** it (stacked), matching the layout before this ticket.
- [ ] Confirm all existing hooks still exist: `data-cy="global-stats-heading"`, `data-cy="global-stats-heading-text"`, `data-cy="global-stats-title"`, `data-cy="global-stats-sync-bar"`.
- [ ] Confirm the new row wrapper carries `data-cy="global-stats-heading-row"`.
- [ ] Switch language to **Français** and repeat the wide/narrow layout check — confirm behaviour is the same.
- [ ] Confirm all other pages that render a sync bar (e.g., `/events`, `/leagues-archive`) are **unaffected** — their layout is unchanged.

## T6 global-rankings-table-columns

- [ ] Open `/global-stats`. Confirm the table has exactly **12** columns: #, Player, Rating, Tournaments, Matches, Wins, Losses, Draw, M%, Nemesis, Rival, Archetype (matches). *(updated by T16)*
- [ ] Confirm no columns named Games, GW, GL, or G% appear anywhere in the table header row.
- [ ] Confirm the Match Win column header reads **Wins** (not MW).
- [ ] Confirm the Match Loss column header reads **Losses** (not ML).
- [ ] Confirm the Match Draw column header reads **Draw** (not MD).
- [ ] Confirm the Archetype column header reads **Archetype (matches)** (not just Archetype).
- [ ] With at least one row in the table, confirm the archetype cell shows `{name} ({number})` with no word "matches" — e.g. `Delver (18)`.
- [ ] With a player that has no archetype, confirm the archetype cell shows **—**.
- [ ] Switch language to **Français**. Confirm: Wins→Victoires, Losses→Défaites, Draw→Nuls, Archetype (matches)→Archétype (matchs).
- [ ] In French, confirm the archetype cell still shows `{name} ({number})` (no "matchs" word inside the cell — only the header carries it).
- [ ] Open `/global-stats?sort=gameWins&direction=desc`. Confirm the table still renders and rows appear reordered by game wins descending (game stats still function as sort keys).
- [ ] With multiple players equal on Wins, confirm higher game wins ranks first (tie-break still works).
- [ ] Confirm the empty-state row (search with no results) spans the full table width (12 columns). *(updated by T16)*
- [ ] Confirm the Player Stats page (`/players/:name`) still shows the archetype cell as `{name} ({count} matches)` — that page was not changed by this ticket.

## T7 hide-ics-for-started-events

Navigate to `/events?view=list` with a running dev server.

- [ ] Find an event whose start time has already passed (started or running). Confirm its card shows **no Add to calendar** button.
- [ ] Find an event whose start time is in the future. Confirm its card shows the **Add to calendar** button.
- [ ] On the same started-event card, confirm the actions container (`div.calendar-event__actions`) still renders (inspect the DOM) — the card grid layout must not collapse.
- [ ] Click **Add to calendar** on a future event and confirm a `.ics` file download begins and the page stays on `/events`.
- [ ] Confirm the Register button behaviour is unchanged (shows/hides by capability, unaffected by this ticket).
- [ ] Switch to **calendar (month) view** (`?view=calendar`). Confirm no ICS button appears there — this ticket only affects the list view.
- [ ] Open `/events/some-slug` (event detail). Confirm the ICS link in the Participants header still appears for both past and future events — this ticket does not touch the detail page.

## T8 event-detail-hero-order

Navigate to `/events/{slug}` for any published event with a running dev server.

- [ ] Confirm the hero layout from top to bottom: **organisation name + player count** on one row (kicker left, count right), then the **title**, then the **summary** (if present), then the **natural-language date + starting hour**, then the **address**, then the **organizers** (if present).
- [ ] Confirm the **title font** is visibly smaller than before — it should no longer dominate the entire page width at desktop viewport (the text sits comfortably alongside the rows below it).
- [ ] Confirm the **player count** (e.g. "32 joueurs") appears on the **same row** as the organisation name/kicker, flush right — not inside the h1.
- [ ] Confirm the **date row** shows the date in natural language (e.g. `vendredi 12 septembre 2026`) with no clock time and no timezone in parentheses.
- [ ] Confirm the **starting hour** appears directly after the date separated by ` - ` (e.g. `Heure de début : 18:00`).
- [ ] Confirm the **address row** shows **only** the venue address — no timestamp, no timezone, no date.
- [ ] Switch language to **English**. Confirm the date row reads in English (e.g. `Friday, September 12, 2026`) and the starting-hour label reads `Starting hour : 18:00`.
- [ ] Navigate to `/events/new` (organizer event creation). Confirm the **preview** section shows the same hero order and same title size.
- [ ] Confirm the viewer-timezone line (`Your time: …`) only appears when your local timezone differs from the venue timezone — it should sit directly below the date row when visible.
- [ ] Confirm no broken layout at mobile viewport (375 px): all rows stack cleanly, no horizontal overflow.

## T9 league-archive-denormalized-counts

Backend-only slice: three denormalized columns on `league_archive_aggregates`, a migration, and a
startup backfill. **Nothing in the UI reads these columns yet**, so the app must look and behave
exactly as it did before — that absence of change is most of what there is to check.

Start the stack with `npm run dev -- --detached --env=demo`. The Postgres service is `postgres` and
the role is `gones_migration` (not `db` / `gones`).

- [ ] Run `docker compose exec -T postgres psql -U gones_migration -d gones -c "select document_id, tournament_count, player_count, counts_version from league_archive_aggregates order by document_id;"` and confirm every row has `counts_version = 1`.
- [ ] Open the Leagues Archive list page and confirm each card's Tournament count and player count match the `tournament_count` / `player_count` stored for that League.
- [ ] Confirm the archive list page renders exactly as before this ticket — no new numbers, badges or layout changes anywhere in the UI.
- [ ] Open a League detail page and confirm the standings row count equals that League's stored `player_count`.
- [ ] Create a new League (or add a Tournament to an existing one) and confirm the stored `tournament_count` / `player_count` update immediately, with `counts_version` still `1`.
- [ ] Rename a League and confirm the counts are unchanged and `counts_version` stays `1`.
- [ ] Soft-delete a League, then confirm the startup backfill leaves it alone: it must not reappear anywhere in the UI.
- [ ] Force a repair: run `docker compose exec -T postgres psql -U gones_migration -d gones -c "UPDATE league_archive_aggregates SET tournament_count = 0, player_count = 0, counts_version = 0;"`, then `docker compose restart api`. Confirm the counts return to their correct values.
- [ ] In `docker compose logs api`, confirm the line `Backfilled the catalog counts of N League archive rows to version 1.` appears after that restart.
- [ ] Restart the API a second time with no stale rows and confirm the log instead reads `League archive catalog counts are current at version 1; no backfill.`
- [ ] Set `GONES_LEAGUES__BACKFILL_CATALOG_COUNTS_ON_STARTUP=false`, stale the rows again, restart the API, and confirm the counts stay stale and the log reports the backfill disabled — then unset it.
- [ ] Confirm the API still starts and serves `/health/ready` when the backfill is disabled.
- [ ] Expect the placeholder League ("Unassigned Tournaments") row to have moved to `version = 2` on the first start after the migration — it is seeded by raw SQL, so the backfill stamps it once. Confirm it has not moved again on later starts.
- [ ] Confirm `GET /api/leagues-archive/all/documents` returns `id,name,status,tournaments,documentVersion,updatedAt` per row and no count field — T9 stored the counts without exposing them. (T10 later moved the whole documents from `/all` to `/all/documents` and gave `/all` the summary shape, so check the documents route here, not `/all`.)

## T10 slim-league-catalog-api

API-only slice: `GET /api/leagues-archive/all` now returns summary rows, the whole documents moved
to `GET /api/leagues-archive/all/documents`, and the paged `GET /api/leagues-archive` is deleted.
The frontend still reads documents (the list page moves to the summary route in T11), so **the UI
must look and behave exactly as it did before** — that absence of change is most of what to check.

> **Superseded by T11 (see that section below).** T11 has since moved the list page onto `/all`, so
> the frontend no longer reads documents anywhere but the Settings export. Every API assertion below
> still holds and is still worth running; only the "the frontend still reads documents" framing is
> out of date. The "renders exactly as before" checks also still hold — T11 changed the payload, not
> the rendering.

Start the stack with `npm run dev -- --detached --env=demo`. The Postgres service is `postgres` and
the role is `gones_migration` (not `db` / `gones`).

- [ ] `curl -s localhost:5080/api/leagues-archive/all | head -c 400` — confirm each row has `id, name, status, updatedAt, documentVersion, tournamentCount, playerCount` and **no** `tournaments`.
- [ ] Confirm each row's `tournamentCount` / `playerCount` equal the two numbers the matching Leagues Archive list card prints in the browser.
- [ ] `curl -s localhost:5080/api/leagues-archive/all/documents | head -c 400` — confirm each row is a whole document with a `tournaments` array.
- [ ] Confirm one row of `/all/documents` is byte-identical to `GET /api/leagues-archive/{id}` for the same League.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' localhost:5080/api/leagues-archive` — confirm **405** (the path still carries `POST`, so the retired GET is Method Not Allowed, not 404).
- [ ] Confirm `curl -s -D- -o /dev/null localhost:5080/api/leagues-archive/all` shows `Cache-Control: public, max-age=3600` and an `ETag`, and that `/all/documents` shows the same header with a **different** ETag.
- [ ] Replay the summary ETag against `/all` with `-H 'If-None-Match: <etag>'` and confirm `304`; replay the **same** ETag against `/all/documents` and confirm `200` (never a 304 with the wrong shape).
- [ ] Open the Leagues Archive list page and confirm it renders exactly as before — same cards, same counts, same ordering, no new fields.
- [ ] Open Settings and run the full export. Confirm the downloaded bundle still carries every server League with all its Tournaments, Rounds and Matches.
- [ ] Import that bundle back and confirm the archive is unchanged.
- [ ] Open a League detail page, a Tournament page and a player statistics page and confirm all still load.
- [ ] Confirm the API log shows `Backfilled the catalog counts of N League archive rows to version 1.` (or the "current at version 1" line) **before** the first request is served — the backfill now blocks startup because `/all` reads those columns.
- [ ] On the 100× stress dataset (`npm run dev:stress:generate` then `npm run dev -- --env=stress --detached`), confirm `curl -s localhost:5080/api/leagues-archive/all | wc -c` is under 60000 while `/all/documents` is still around 1.4 MB.
- [ ] Confirm the Leagues Archive list page still renders the full stress archive without visible slowdown.

## T11 league-archive-list-summary

Frontend slice: the Leagues Archive list page now reads the slim catalog (`GET
/api/leagues-archive/all`) instead of whole documents, browser-local Leagues compute their own two
counts, and the TTL cache entry moved to `gones.leagues-archive.catalog.v2`. **No user-visible
layout change** — the payload changed, not the page — so most of what follows is confirming the
cards still say exactly what they said before.

Start the stack with `npm run dev -- --detached --env=demo`, or `--env=stress` where a step says so.

- [ ] Open `/leagues-archive` with DevTools → Network open. Confirm one request to `/api/leagues-archive/all` and **zero** requests to `/api/leagues-archive/all/documents`.
- [ ] Confirm that response body carries `tournamentCount` / `playerCount` per row and **no** `tournaments` array.
- [ ] Confirm each card's meta line reads the same two numbers it read before this slice (e.g. `2 Tournaments · 3 Players`).
- [ ] Switch the language to French and confirm the meta line translates (`2 tournois · 3 joueurs`) — the counts go through i18n, not string concatenation.
- [ ] Confirm a League with exactly one Tournament and one player reads `1 Tournament · 1 Player` (singular, both halves).
- [ ] In DevTools → Application → Local Storage, confirm `gones.leagues-archive.catalog.v2` exists and holds summary rows.
- [ ] Confirm **no** `gones.leagues-archive.catalog` (v1, no suffix) key is present.
- [ ] Upgrade path: manually set a `gones.leagues-archive.catalog` key to any value, reload `/leagues-archive`, and confirm the page fetches fresh (never renders blank or count-less cards from that old row).
- [ ] Create a League from the list page, then confirm both catalog keys are gone from Local Storage and the new League appears immediately (no 24h wait).
- [ ] Finalize a Live Tournament, then open `/leagues-archive` and confirm the resulting Archive Tournament is counted in its League's card straight away.
- [ ] Signed out, create a browser-local League, add one Tournament with one match (Alice vs Bob). Confirm its card reads `1 Tournament · 2 Players` and carries the local badge.
- [ ] Confirm the browser-local card and a server card sit in the same grid with the same meta format — the merged list must look uniform.
- [ ] Confirm the empty "Unassigned Tournaments" placeholder is still hidden from the list, and that it appears once it holds at least one Tournament.
- [ ] With more than 9 Leagues, confirm the name filter still appears and filters **both** halves of the merged list without any network request.
- [ ] Take the server offline (stop the API) with a fresh cache present and confirm the list still renders from `…catalog.v2` behind the stale banner.
- [ ] With no cache and the API down, confirm the "server unavailable" notice shows and browser-local Leagues still render.
- [ ] Click Synchronize and confirm it refetches `/all` (not `/all/documents`) and updates the "last synced" instant.
- [ ] Settings → export: confirm the full bundle still contains every League with all its Tournaments, Rounds and Matches, and that the request goes to `/all/documents`.
- [ ] Import that bundle back and confirm the archive is unchanged.
- [ ] Open a League detail page and a Tournament page from a list card and confirm both still load.
- [ ] On the 100× stress dataset (`npm run dev:stress:generate` then `npm run dev -- --env=stress --detached`): confirm the `/all` response in DevTools → Network is **under 60 KB** (measured 33.3 KB for 201 rows).
- [ ] On that same dataset, confirm the list renders all ~200 cards with correct counts and no visible slowdown. There is deliberately **no** pagination control — the whole catalog arrives and the browser slices it.
- [ ] On that same dataset, confirm `gones.leagues-archive.catalog.v2` in Local Storage is well under the ~5 MB quota (it was ~2.9 MB of documents before this slice).

## T12 response-compression

Backend slice: the API compresses its own responses — brotli `Optimal` first, gzip `Fastest` as
the fallback — but **only for GET requests that carry no `Authorization` header and no
`gones_refresh` cookie**. That narrowing is the BREACH mitigation (ADR 0042): a compressed response
that carries a session secret next to attacker-influenced input leaks the secret through its own
length. **No user-visible change** — browsers decompress transparently — so most of what follows is
confirming the header is there and that nothing broke.

Start the stack with `npm run dev -- --detached --env=demo`, or `--env=stress` where a step says so.
Rebuild the API image first (`docker compose build api`) or you will measure the previous build.

- [ ] `curl -s -H 'Accept-Encoding: br' -o /dev/null -D - localhost:5080/api/leagues-archive/all | grep -i content-encoding` prints `Content-Encoding: br`.
- [ ] The same request also prints `Vary: Accept-Encoding`.
- [ ] The same request with `-H 'Accept-Encoding: gzip'` prints `Content-Encoding: gzip`.
- [ ] The same request with **no** `Accept-Encoding` prints no `Content-Encoding`.
- [ ] The same request with `-H 'Authorization: Bearer x'` added prints **no** `Content-Encoding` (still `200`).
- [ ] The same request with `-H 'Cookie: gones_refresh=x'` added prints **no** `Content-Encoding` (still `200`).
- [ ] A conditional replay (`-H "If-None-Match: <etag>" -H 'Accept-Encoding: br'`) answers `304` with no `Content-Encoding`.
- [ ] `curl -s -o /dev/null -D - -H 'Accept-Encoding: br' localhost:5080/api/leagues-archive/does-not-exist` answers `404` with `Content-Type: application/problem+json` **and** `Content-Encoding: br`.
- [ ] A write (`POST /api/leagues-archive`, any request) prints no `Content-Encoding` — only GETs are compressed.
- [ ] Sign in, then in DevTools → Network confirm an authenticated read (e.g. `/api/users/me`) has **no** `content-encoding` response header while `/api/events/all` on the same page does.
- [ ] On the 100× stress dataset, confirm the measured sizes: `/api/leagues-archive/all` ≈ 34 KB identity / 1.5 KB br (Optimal), `/api/leagues-archive/all/documents` ≈ 1.44 MB identity / 123 KB br (Optimal) / 199 KB gzip (Fastest).
- [ ] Real-browser request (`Accept-Encoding: gzip, deflate, br`) on `/api/leagues-archive/all/documents` returns `Content-Encoding: br` with body ≈ 123 KB — smaller than the gzip-Fastest ceiling of 199 KB.
- [ ] Open `/leagues-archive`, `/events` and `/global-stats` and confirm every page renders exactly as before — the browser decodes the compressed body with no code change.
- [ ] Settings → export the full bundle over the compressed `/all/documents` route and confirm the downloaded file is intact and re-importable.

## T13 glicko2-engine

Pure-domain slice: three new classes in `Gones.Domain.Leagues` (`Glicko2`, `Glicko2Decay`,
`MarginOfVictory`) and their unit tests. **Nothing calls them yet** — no endpoint, no database column,
no UI, no configuration key. There is nothing a human can click for this ticket; the engine becomes
observable in T14 (rating-period replay and storage) and visible in T15–T19. The correctness evidence
is the automated anchor below, not a manual step.

- [ ] `npm run backend:test` passes — in particular `Glicko2Tests.Reproduces_the_published_worked_example`, which reproduces Glickman's own published example: player (1500, 200, 0.06) beats (1400, 30) then loses to (1550, 100) and (1700, 300) → rating 1464.0506705393013, deviation 151.51652412385727, volatility 0.059995984286488495 (the paper prints 1464.06 / 151.52 / 0.05999; it rounds its intermediates to four decimals).
- [ ] Confirm the app is unchanged: open `/leagues-archive`, `/global-stats` and any player page and check that no rating, badge or column has appeared yet. That absence is the expected outcome of this slice.

## T14 rating-read-model-replay

Storage and computation half of the Player Rating. `player_statistics` gains eight rating columns,
filled by a full deterministic Glicko-2 replay inside the existing ADR 0040 rebuild transaction, at
formula version 2. **No endpoint serves them yet and no UI shows them** — the API still answers with
the old DTO, so every check below that touches a screen is a check that *nothing changed*. The rating
itself is only observable in the database until T15.

Set-up: `npm run dev:stress:generate`, then `npm run dev -- --env=stress` (the 100× dataset; local
data is reset). The compose service is `postgres` and the role is `gones_migration`.

- [ ] The API log at startup prints `Rebuilding player statistics: stored formula version (null) is not 2.` followed by `Player statistics rebuilt: 1183 rows from 201 Leagues in <N> ms.` — `docker compose logs api | grep "Player statistics"`.
- [ ] `docker compose exec postgres psql -U gones_migration -d gones -c "select formula_version from player_statistics_meta"` → `2`.
- [ ] `docker compose exec postgres psql -U gones_migration -d gones -c "select player_name, round(rating::numeric,2), round(rating_deviation::numeric,2), tournaments_played, last_played_date from player_statistics order by rating desc limit 10"` returns plausible ratings — top around 1900–1950, deviations between roughly 150 and 300, `tournaments_played` at least 1, and a non-null `last_played_date` on every row.
- [ ] No stored deviation exceeds 350 and none is exactly the 1500/350 seed: `select count(*) filter (where rating_deviation > 350) too_wide, count(*) filter (where rating = 1500 and rating_deviation = 350) at_seed from player_statistics` → `0 | 0`.
- [ ] The decay is real: pick a player whose `last_played_date` is years old and confirm `decayed_rating` sits between `rating` and 1500, closer to 1500 the older the date. Check one by hand against `1500 + (rating - 1500) * 0.5 ^ (idleMonths / 24)`.
- [ ] The delta is self-consistent on every row: `select count(*) from player_statistics where abs(last_rating_delta - (rating - previous_rating)) > 1e-9` → `0`.
- [ ] Rebuilding twice on the same day changes nothing: note a few ratings, run `update player_statistics_meta set formula_version = 1;`, `docker compose restart api`, wait, and confirm the same ratings come back identical.
- [ ] An archive edit self-heals an **old** Tournament: edit the score of a Match in the *earliest* Tournament of a League through the UI, save, and confirm every later rating of both players moved — not just that Tournament's.
- [ ] Deleting a League removes its players' rows and re-replays the rest (`select count(*) from player_statistics` drops).
- [ ] **Nothing visible changed.** Open `/global-stats` and confirm the same 12 columns as before this ticket (#, Player, Tournaments, Matches, Wins, Losses, Draw, M%, Nemesis, Rival, Archetype (matches), and no Rating) — no rating column, no badge, no delta.
- [ ] Open a player page (`/players/<name>`) and confirm the statistics, match history, filters and pagination are exactly as before.
- [ ] Open `/leagues-archive` and a League's standings and confirm no rating column has appeared.
- [ ] `curl -s "localhost:5080/api/leagues-archive/global-player-statistics?page=1&size=3"` returns the **old** shape — no `rating`, `tournamentsPlayed`, `lastPlayedDate` or `decayedRating` anywhere in the JSON.
- [ ] `curl -s "localhost:5080/api/players/<name>"` likewise carries no rating field.
- [ ] Gones Export from Settings still produces a bundle with no rating in it, and restoring that bundle into a clean stack recomputes the ratings from scratch (the rating is derived, never exported).
- [ ] The full-stack smoke gate still agrees on the migration list: `npm run smoke:full-stack` (or the gate that calls `scripts/smoke-full-stack.mjs`) does not throw `PostgreSQL migrations differ.`

## T15 rating-statistics-api

Set-up: `npm run dev:stress:generate`, then `npm run dev -- --env=stress` (the 100× dataset; local
data is reset). The compose service is `postgres` and the role is `gones_migration`. Rebuild the API
image first (`docker compose build api worker`) — a stale image serves the old contract.

This ticket is API-only. Nothing on the rankings page or the player page changes visually until T16.

- [ ] Every row carries the rating block: `curl -s "localhost:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=10" | jq '.items[0]'` shows `rating`, `ratingDeviation`, `previousRating`, `lastRatingDelta`, `tournamentsPlayed`, `lastPlayedDate`, `provisional`, `inactive` and `decayedRating`.
- [ ] `rating` and `previousRating` are whole numbers, and `lastRatingDelta` equals their difference on every row: `curl -s "localhost:5080/api/leagues-archive/global-player-statistics/all" | jq '[.items[] | select(.lastRatingDelta != (.rating - .previousRating))] | length'` → `0`.
- [ ] `decayedRating` is `null` on every row — T19 owns the switch that fills it: `curl -s "localhost:5080/api/leagues-archive/global-player-statistics/all" | jq '[.items[] | select(.decayedRating != null)] | length'` → `0`.
- [ ] The four game columns T6 dropped from the table are still on the wire: `jq '.items[0] | {playedGameCount, gameWins, gameLosses, gameWinrate}'` on the same read.
- [ ] `provisional` is exactly "fewer than 5 Tournaments": `jq '[.items[] | select(.provisional != (.tournamentsPlayed < 5))] | length'` → `0`.
- [ ] No player is both provisional and inactive: `jq '[.items[] | select(.provisional and .inactive)] | length'` → `0`.
- [ ] A player idle over a year is flagged: pick one with an old `lastPlayedDate` and at least 5 Tournaments and confirm `inactive: true`; pick one who played in the last few months and confirm `inactive: false`.
- [ ] The default order is the three buckets in order — page through the whole ranking and confirm the bucket number never goes back down: `for p in $(seq 1 12); do curl -s "localhost:5080/api/leagues-archive/global-player-statistics?page=$p&pageSize=100"; done | jq -s '[.[].items[] | if .provisional then 2 elif .inactive then 1 else 0 end] | . == (. | sort)'` → `true`.
- [ ] Active ranked players lead, by rating descending, and an inactive player with a **higher** rating than the leader still sits below every active one.
- [ ] Provisional players are last, ordered by `tournamentsPlayed` descending and then `playedMatchCount` descending — a 1900-rated provisional player does not jump the queue.
- [ ] Two names that differ only in case are adjacent and capital-first (`Alice` before `alice`).
- [ ] `?sort=rating&direction=asc` returns ratings ascending and **ignores** the buckets (a provisional player can lead).
- [ ] `?sort=tournamentsPlayed` returns counts descending, and tied counts fall back to the ordinal name order.
- [ ] `?sort=bogus` → `400` with `sort` named in the problem body; every pre-existing sort (`matchWins`, `gameWinrate`, …) still works in both directions.
- [ ] The catalog `/global-player-statistics/all` is **not** re-ranked: it stays ordered by `playedMatchCount` descending, and only gained the new fields.
- [ ] The player page inherits the block: `curl -s "localhost:5080/api/players/<name>" | jq '.statistics | {rating, lastRatingDelta, tournamentsPlayed, provisional, inactive}'`.
- [ ] The ETag turns over at midnight UTC on all three reads. Note the ETag of `?pageSize=100`, of `/all` and of `/api/players/<name>`; move the host clock (or the container's) past midnight; confirm all three ETags change with no rebuild in between, and that a conditional request with the old ETag answers `200`, not `304`.
- [ ] Within the same day the ETags are stable and a conditional request still answers `304`.
- [ ] `/global-stats` still renders, sorts, filters and pages exactly as before — the page ignores the new fields until T16. Note that its client-side default order is still the old `matchWins` one; that mirror is T16's job.
- [ ] A player page opened from the rankings still shows the same statistics, history, filters and pagination as before.

## T16 global-rankings-rating-column

Run `npm run dev -- --env=demo`.

- [ ] Open `/global-stats`. The table has **12** columns in order: #, Player, Rating, Tournaments, Matches, Wins, Losses, Draw, M%, Nemesis, Rival, Archetype (matches).
- [ ] The **Rating** column header is clickable. Click it: the URL gains `?sort=rating&direction=desc` and the table reorders with the highest-rated player at position 1.
- [ ] Click **Rating** again: the direction toggles to `asc` and the lowest-rated player is at position 1.
- [ ] With no `?sort=` in the URL (or after removing it), confirm the default order is: active ranked players first (by rating desc), then inactive players (by rating desc), then provisional players last (by tournamentsPlayed desc, then matches desc). Position 1 is an active ranked player, not necessarily the one with the most match wins.
- [ ] The client order for position 1 matches the first row returned by `curl 'localhost:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=25'`.
- [ ] Find a **provisional** player (fewer than 5 tournaments played — demo data has many). Confirm the Rating cell shows an integer rating value and a `PROVISIONAL` badge (all-caps).
- [ ] Find an **inactive** player (no tournament in the last 12 months). Confirm the Rating cell shows an integer rating value and an `INACTIVE` badge.
- [ ] For an active ranked player, confirm no badge appears in the Rating cell.
- [ ] For any player whose rating improved since last period, confirm a `+N` delta appears in the Rating cell in green (smaller than the rating number).
- [ ] For any player whose rating dropped, confirm a `−N` delta appears in red.
- [ ] For a player with zero delta, confirm the delta span is empty (no `+0` or `-0`).
- [ ] Click the **Tournaments** column header. Confirm `?sort=tournamentsPlayed` is in the URL and the player with the most tournaments is at position 1.
- [ ] Type a search term that returns zero rows: the empty-state row spans all **12** columns with no layout break.
- [ ] Switch language to **Français**: the Rating header reads **Classement**, Tournaments reads **Tournois**, the provisional badge reads **PROVISOIRE**, the inactive badge reads **INACTIF**.
- [ ] A stale-cached row with no rating field (simulate by refreshing with a pre-T16 cache entry via DevTools Application→Local Storage, or by clearing the cache and mocking the API) shows **—** in the Rating cell with no crash.

## T17 player-page-rating

- [ ] Open any player page. Confirm the first stat row shows **Rating**, **Tournaments played**, and **Rating status** cells above the Match Win Rate row.
- [ ] The Rating cell shows an integer (e.g. `1524`) with a coloured delta (e.g. `+28` in green or `-13` in red). A zero delta shows no `+0` or `-0`.
- [ ] The Tournaments played cell shows the integer count from the server.
- [ ] The Rating status cell shows `Ranked`, `Provisional`, or `Inactive` depending on the player's server flags.
- [ ] With **Only use online data** ON, the rating row shows the server values and the local-note paragraph is absent.
- [ ] Toggle **Only use online data** OFF when a local League is present: the rating values do not change, and the paragraph "Local matches never affect the rating: it is computed from the server archive only." appears below the stat grid.
- [ ] Toggle back ON: the local-note paragraph disappears.
- [ ] Open a player whose name the server does not know (local-only player, no server statistics): all three rating cells show `—` and the status cell shows `Not rated`.
- [ ] Switch language to **Français**: labels read **Classement**, **Tournois joués**, **État du classement**; statuses read **Classé / Provisoire / Inactif / Non classé**.

## T18 league-standings-rating-column

- [ ] Navigate to a League detail page (server mode). Confirm the standings table has a **Rating** column as the last column after OGW.
- [ ] The Rating column shows integer ratings (e.g. `1524`) for players present in the global catalog; players absent from the catalog show `N/A`.
- [ ] The Rating column header is NOT clickable and has no sort arrow.
- [ ] The row order (by Swiss points) is unchanged; the Rating column is purely informational.
- [ ] Navigate to a Tournament result page (inside a League). Confirm the result table shows exactly 7 columns (no Rating column).
- [ ] Open a browser-local League (no server connection). The standings table shows **N/A** in every rating cell with no console error.
- [ ] Switch language to **Français**: the Rating column header reads **Classement**.

## T19 decayed-rating-config-key

### Default stack (key OFF)
- [ ] `curl -s 'localhost:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=3' | jq '.items[].decayedRating'` prints `null` three times.
- [ ] Open `/global-stats` — table has exactly 12 columns (no Decayed column).
- [ ] `?sort=decayedRating` on the rankings endpoint returns HTTP 400.

### Key ON (restart with `GONES_PLAYER_STATISTICS__EXPOSE_DECAYED_RATING=true`)
- [ ] Same `curl` command now prints integers instead of `null`.
- [ ] Open `/global-stats` — table now has 13 columns; the **Decayed** column appears immediately after **Rating**.
- [ ] The Decayed column is clickable/sortable; clicking it toggles the sort arrow.
- [ ] Switch language to **Français**: the Decayed column header reads **Déclassé**.
- [ ] `SELECT formula_version FROM player_statistics_meta;` in the DB still returns `2` (no rebuild ran).
- [ ] Navigate to a player page — `statistics.decayedRating` in the JSON response is an integer.

## T20 review-repairs

Closes the round-6 branch review. Behaviour changes are limited to two: `/api/auth` responses are
never compressed, and the rankings order the rounded rating rather than the stored double. Everything
else in this ticket is documents, copy and test strength, so most checks below are "nothing moved".

Run `npm run dev -- --env=demo`. Rebuild the API image first (`docker compose build api worker`) — a
stale image serves the old compression predicate.

### A — compression never touches an auth response

- [ ] `curl -s -D- -H 'Accept-Encoding: br' 'http://127.0.0.1:5080/api/auth/oauth/google/callback' -o /dev/null` returns **no** `Content-Encoding` header.
- [ ] `curl -s -D- -H 'Accept-Encoding: br' 'http://127.0.0.1:5080/api/leagues-archive/all' -o /dev/null` still returns `Content-Encoding: br` — the public catalog is unchanged.
- [ ] `curl -s -D- -H 'Accept-Encoding: br' -H 'Authorization: Bearer nope' 'http://127.0.0.1:5080/api/leagues-archive/all' -o /dev/null` still returns no `Content-Encoding` — the credentialed case is unchanged.
- [ ] Sign in through the UI with a demo account and confirm the whole flow still works: sign in, refresh the page, sign out.

### D — the rankings order the rating they display

- [ ] Open `/global-stats`. For any two adjacent rows showing the **same** integer rating, confirm the one listed first has the alphabetically earlier Player Name (uppercase before lowercase).
- [ ] The same pair is in the same order in `curl -s 'localhost:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=100' | jq -r '.items[] | "\(.rating) \(.playerName)"'` — the paged endpoint and the browser-sorted catalog agree row for row.
- [ ] Click **Rating** to sort ascending and descending; equal displayed ratings still break on the name ascending in **both** directions.

### E — the client refuses a sort the server refuses

- [ ] With the decayed key **off** (default), open `/global-stats?sort=decayedRating&direction=desc`. The table renders in the default order, no Decayed column appears, and no header shows a sort arrow.
- [ ] Restart with `GONES_PLAYER_STATISTICS__EXPOSE_DECAYED_RATING=true` and reopen the same URL. The Decayed column appears **and** carries the descending sort arrow.

### F — no French label says "mondial"

- [ ] Covered by the three lines added to the round-6 **T4** section above.

### G, B, C — the documents match the build

- [ ] `docs/CONTEXT.md` says the Player Rating **is stored** in eight `player_statistics` columns and that only provisional/inactive are derived at read time.
- [ ] `docs/adr/0043-glicko2-player-rating.md` and `docs/player-rating-glicko2.html` both describe **two** sums — unweighted `S` into `Δ`/`σ'`/`φ'`, weighted `Sw` into `μ'` only — matching `Glicko2.cs`.
- [ ] Both documents state the 24-month ceiling on idle deviation growth.
- [ ] Open `docs/player-rating-glicko2.html` in a browser and confirm the formula block still renders (the `Sw` line did not break the layout).
- [ ] `npm run acceptance:matrix` exits 0 with the Global Rankings rows reading **12-col**.

## T21 archive-list-browser-pagination

The League Archive list now slices the catalog it already holds. No new request is issued;
paging is purely client-side. The name filter continues to work across the full merged list and
resets to page 1 when its value changes.

Start the stack with `npm run dev -- --detached --env=stress` (201 Leagues) or seed at least 26
Leagues manually so the default page size (25) is exceeded.

- [ ] Open `/leagues-archive` with DevTools → Network open. Confirm exactly one request to `/api/leagues-archive/all`. Navigate to page 2 using the "Next" button and confirm no second network request is made.
- [ ] Confirm the pagination nav is visible: Previous button, page status text, and Next button.
- [ ] Confirm Previous is disabled on page 1 and Next is disabled on the last page.
- [ ] Click Next to advance to page 2; confirm Previous becomes enabled and the displayed cards are different from page 1.
- [ ] Click Previous to return to page 1; confirm Previous is disabled again.
- [ ] With more than 9 Leagues loaded, type in the search field to filter down to 3 matches. Confirm all 3 are shown and the paginator disappears (single page).
- [ ] While on page 2, type in the search field. Confirm the view resets to page 1 and shows the filtered results.
- [ ] Open `/leagues-archive` with exactly 5 Leagues; confirm the pagination nav is absent (all rows visible).
- [ ] Signed out with browser-local Leagues, confirm they appear alongside server rows and both kinds paginate together without reordering.
- [ ] Refresh the page while on page 2; confirm the browser returns to page 1 (no URL persistence required).

## T3 power-user-storage-reactivity

Power User mode is a browser preference, and it now behaves like the language preference: a change
made in one tab reaches the others straight away instead of leaving them stale until a reload.

Use two tabs of the same browser profile on the same origin (`http://localhost:4200`), signed out is
enough.

- [ ] Tab A: open `/settings`, leave Power User **off**. Tab B: open `/leagues-archive` and confirm the "New League" create card is absent.
- [ ] In tab A, tick the Power User checkbox. Switch to tab B **without reloading it**: the create card is now there, and the header import control has appeared.
- [ ] In tab A, untick the Power User checkbox. Tab B, still without a reload, drops the create card and the import control again.
- [ ] Tab B: reload once and confirm the visible state matches the toggle in tab A (the reactive state and the persisted state agree).
- [ ] Toggle Power User on in tab A while tab B sits on a Live tournament detail page: tab B gains its edit affordances without a reload, and the read-only banner disappears.
- [ ] Open a private/incognito window alongside: toggling Power User there changes nothing in the normal window (the preference stays per browser profile, not shared).

## T1 reset-and-squash

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


The 35 accumulated EF migrations were collapsed into a single `InitialCreate` that produces the same
schema, and every local store holding archive data was emptied. Nothing about the product changed —
no route, no response shape, no domain rule — so this pass is looking for the *absence* of breakage,
plus an archive that is genuinely empty.

An empty archive is the expected, correct state between now and T13. It is not a bug to report.

Start from a freshly reset stack (`npm run db:reset`), then in the browser clear the client stores
once: DevTools console → `localStorage.clear(); indexedDB.deleteDatabase('gones-leagues');` → hard
reload (Ctrl+Shift+R). Clearing `localStorage` signs you out; that is expected.

- [ ] Open `/leagues-archive`. It renders the empty-list state, with no error toast and no red error in the DevTools console.
- [ ] In the DevTools console run `indexedDB.databases().then(d => console.log(d.map(x => x.name)))`. Confirm `gones-leagues` is absent, and that `gones-live` is still listed (Live data is deliberately untouched).
- [ ] In the DevTools console run `Object.keys(localStorage).filter(k => k.includes('archive'))`. Confirm it prints `[]`.
- [ ] Sign in. Confirm sign-in works and lands you back in the app.
- [ ] Load `/events`. The calendar renders and existing events are listed — the table rename survived the squash.
- [ ] Load `/global-stats`. The page renders. Player statistics are empty, which is correct: the archive they are derived from is empty.
- [ ] Open a Live tournament from the Live section and confirm it still loads with its data intact — the squash must not have touched `gones-live`.
- [ ] Create a new archive League from `/leagues-archive` (Power User mode on), save it, and reload. It persists — writes still work against the new schema.
- [ ] Delete that League again and confirm the list returns to the empty state.
- [ ] Open the event-create form and confirm the format picker offers `Legacy` — the carried `tournament_formats` seed row survived the squash.
- [ ] Open a deck-archetype picker (for example while recording a Live result) and confirm the preset archetype list is populated, including `Reanimator (Rakdos)` — the carried 49-row `deck_archetypes` seed survived.
- [ ] In `/admin/organizations`, confirm existing organizations still list and their member rosters render.

## T2 three-tier-schema

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


The backend foundation for the three-tier archive — League → LeagueSeason → Tournament. This slice adds
domain aggregates, the EF mapping and one migration creating three empty tables. **Nothing reads or
writes them yet**, and no route, response shape or screen changed. So this pass is looking for the
*absence* of breakage, plus proof that the three tables really exist.

Three empty archive tables and an archive that still shows only `Unassigned Tournaments` are the
expected, correct state at this point. Neither is a bug to report.

Start from a freshly reset stack (`npm run db:reset`).

- [ ] Run `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select "MigrationId" from "__EFMigrationsHistory" order by "MigrationId";'`. It prints exactly two lines: `20260822145459_InitialCreate` then `20260822183905_RebuildArchiveThreeTier`.
- [ ] Run `docker compose exec -T postgres psql -U gones_migration -d gones -c '\d archive_leagues' -c '\d archive_league_seasons' -c '\d archive_tournaments'`. All three tables exist, each with `document_id | text | not null` as its primary key.
- [ ] In that same output, confirm `archive_tournaments` has `tournament_date | date | not null`, `document | jsonb | not null`, and a nullable `season_id` — a Tournament is allowed to stand alone with no Season.
- [ ] In that same output, confirm the foreign keys read `league_id` → `archive_leagues(document_id)` and `season_id` → `archive_league_seasons(document_id)`, and that neither says `ON DELETE CASCADE`.
- [ ] Run `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select (select count(*) from archive_leagues), (select count(*) from archive_league_seasons), (select count(*) from archive_tournaments);'`. It prints `0|0|0` — the tables are created empty on purpose and stay empty until a later slice fills them.
- [ ] Open `/leagues-archive` in the browser. The list renders exactly as it did before this change, with no error toast and no red error in the DevTools console.
- [ ] With Power User mode on, create an archive League from `/leagues-archive`, save it, and reload. It persists — the legacy archive surface is untouched by this slice and must keep working.
- [ ] Delete that League again and confirm the list returns to its previous state.
- [ ] Open an existing archive League and its Tournament detail page. Standings, player counts and dates all render as before.
- [ ] Load `/global-stats` and confirm it renders — player statistics are derived from the legacy archive and must be unaffected.
- [ ] Open a Live tournament and confirm it loads with its data intact.
- [ ] Load `/events` and confirm the calendar renders with existing events.

## T3 league-season-commands

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


Eight organizer-gated write routes under `/api/archive` — create/rename/delete a League, and
create/rename/restatus/re-parent/delete a LeagueSeason. **There is still no UI for any of this**: T13
wires the screens. So this pass is done with `curl`, and it is looking for two things — that the new
routes behave, and that the legacy `/api/leagues-archive/**` surface is completely unmoved.

An archive that still shows only `Unassigned Tournaments` in the browser is the expected, correct state
at this point, not a bug to report.

Start from a stack running this branch (`npm run dev -- --detached`, which enables auth), then
`npm run dev:accounts` to seed `admin@gones.test` (Admin) and `test@gones.test` (User), password
`Gones-dev-pass-123!`. Get a token with:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:5080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@gones.test","password":"Gones-dev-pass-123!","deviceLabel":"manual"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
```

- [ ] `curl -si -X POST http://127.0.0.1:5080/api/archive/leagues -H 'Content-Type: application/json' -d '{"name":"Ligue de Lyon"}'` with **no** Authorization header returns `401` and a body whose `code` is `unauthorized`.
- [ ] The same call with a `test@gones.test` token returns `403` and `"code":"forbidden"` — a plain User cannot write the archive.
- [ ] The same call with `$TOKEN` returns `201`, an `ETag: "AAAAAAAAAAE="` header, a `Location:` header of the form `/api/archive/leagues/<uuid>`, and a body carrying `"documentVersion":1` and an `eTag` identical to the header. Keep that id as `LID`.
- [ ] Repeat the create with `{"name":"  Ligue de Lyon  "}`. The stored name is trimmed: the response is `201` and a later read shows `Ligue de Lyon`, not the padded string. Delete this second League afterwards.
- [ ] `POST /api/archive/leagues` with `{"name":"   "}` returns `400` with `"code":"validation_failed"` and an `errors.name` entry. Same for a name longer than 200 characters.
- [ ] `POST /api/archive/league-seasons` with `{"leagueId":"does-not-exist","name":"X"}` returns `404` with `"code":"not_found"` — a Season cannot be created under a League that is not there.
- [ ] `POST /api/archive/league-seasons` with `{"leagueId":"<LID>","name":"Saison 2026"}` returns `201`, an `ETag: "AAAAAAAAAAE="`, and a `Location:` of `/api/archive/league-seasons/<uuid>`. Keep that id as `SID`. Confirm with psql that its `status` defaulted to `active`: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select status, league_id from archive_league_seasons where document_id = '<SID>';"`.
- [ ] `POST /api/archive/league-seasons` with `{"leagueId":"<LID>","name":"Bad","status":"archived"}` returns `400` `validation_failed` — only `active` and `completed` are accepted.
- [ ] `DELETE /api/archive/leagues/<LID>` with `-H 'If-Match: "AAAAAAAAAAE="'` returns `409` with `"code":"archive_league_not_empty"`, and psql shows `deleted_at` still NULL and `version` still `1` on that League — a refused delete changes nothing.
- [ ] `PATCH /api/archive/leagues/<LID>/name` with `-H 'If-Match: "AAAAAAAAAGM="'` (a deliberately wrong version) and `{"name":"Nope"}` returns `412` with `"code":"stale_version"`.
- [ ] The same PATCH with **no** `If-Match` header at all also returns `412` `stale_version` — the header is mandatory, not optional.
- [ ] The same PATCH with the correct `If-Match: "AAAAAAAAAAE="` returns `200`, `"documentVersion":2`, and an `ETag: "AAAAAAAAAAI="`. Re-sending that exact request now returns `412`, because version 1 no longer matches.
- [ ] `PATCH /api/archive/league-seasons/<SID>/status` with `{"status":"completed"}` and `If-Match: "AAAAAAAAAAE="` returns `200` and `"documentVersion":2`.
- [ ] `PATCH /api/archive/league-seasons/<SID>/league` with `{"leagueId":"<a second League id>"}` and the Season's current `If-Match` returns `200`. Then confirm with psql that **neither** League's `version` moved: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select document_id, version from archive_leagues;'`. Moving a Season must never bump a League.
- [ ] `PATCH /api/archive/league-seasons/<SID>/league` with `{"leagueId":"does-not-exist"}` returns `404` `not_found`, and the Season's `version` is unchanged.
- [ ] `DELETE /api/archive/league-seasons/<SID>` with the Season's current `If-Match` returns `200` with `"deleted":true`. psql shows the row still present with a non-NULL `deleted_at` — deletes are soft, the row is a tombstone.
- [ ] Repeat that DELETE with the new ETag. It returns `404` `not_found` — a second delete of the same id is not an error path that mutates anything.
- [ ] `DELETE /api/archive/leagues/<LID>` now succeeds with `200`, `"deleted":true` and `"documentVersion":2`, because its only Season is gone.
- [ ] Detach check, if you can put a Tournament under a Season by hand: insert a row into `archive_tournaments` with `season_id` set to a live Season, then delete that Season. The Tournament row must **still exist**, with `season_id` NULL, its `version` bumped by exactly 1, and `document ->> 'seasonId'` also NULL. Deleting a Season never deletes Tournament data.
- [ ] Open `/leagues-archive` in the browser. It renders exactly as before, with no error toast and no red error in the DevTools console.
- [ ] With Power User mode on, create an archive League from `/leagues-archive`, save it, reload, then delete it. The legacy archive surface is untouched by this slice and must keep working end to end.
- [ ] Open an existing archive League and one of its Tournament detail pages. Standings, player counts and dates render as before.
- [ ] Load `/global-stats`, open a Live tournament, and load `/events`. All three render normally — none of them is touched by this slice.

## T4 tournament-commands-locking

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


Run against a `npm run db:reset` stack with the API on `http://127.0.0.1:5080`. Reuse the `$TOKEN`
(Admin) helper from the T3 section, and get a second token for a plain Organizer where a step says
"as an Organizer". `TODAY=$(date -u +%F)`, `OLD=$(date -u -d '366 days ago' +%F)`,
`EDGE=$(date -u -d '365 days ago' +%F)`.

- [ ] Create a League and a Season with the T3 routes and keep their ids as `LID` and `SID`. Create a second Season under the same League and keep it as `SID2`.
- [ ] `curl -si -X POST http://127.0.0.1:5080/api/archive/tournaments -H 'Content-Type: application/json' -H 'Idempotency-Key: m1' -d '{"name":"Standalone","tournamentDate":"'"$TODAY"'","seasonId":null}'` with **no** Authorization header returns `401`. With a plain `test@gones.test` token it returns `403` `"code":"forbidden"`.
- [ ] The same call with `$TOKEN` returns `201`, an `ETag: "AAAAAAAAAAE="`, a `Location:` of `/api/archive/tournaments/<uuid>`, and a body with `"seasonId":null`, `"status":"active"`, `"documentVersion":1` and an `eTag` identical to the header. Keep the id as `TID`. A standalone Tournament is a first-class row.
- [ ] Repeat that exact request with the same `Idempotency-Key: m1`. It returns `201` again with the **same** `id`, and psql shows only one row: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*) from archive_tournaments where name = 'Standalone';"`.
- [ ] Repeat it once more with `Idempotency-Key: m1` but a different `"name"`. It returns `409` `"code":"idempotency_conflict"`.
- [ ] The same create with **no** `Idempotency-Key` header returns `400` `"code":"validation_failed"`.
- [ ] `POST /api/archive/tournaments` with `"seasonId":"does-not-exist"` returns `404` `"code":"not_found"` and inserts nothing.
- [ ] Create two Tournaments under `SID` dated 60 and 10 days ago. Then check the Season counters and that the Season row itself did not move: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version, version from archive_league_seasons where document_id = '<SID>';"`. `tournament_count` is `2`, the two dates bracket them, `counts_version` is `1`, and `version` is still `1`. Filling a Season must never bump the Season.
- [ ] `PATCH /api/archive/tournaments/<TID>` with `If-Match: "AAAAAAAAAAE="` and `{"name":"Renommé","tournamentDate":"'"$TODAY"'","status":"completed"}` returns `200`, `"documentVersion":2`, and an `ETag: "AAAAAAAAAAI="`.
- [ ] The same PATCH with a wrong `If-Match: "AAAAAAAAAGM="`, and again with **no** `If-Match` header, both return `412` `"code":"stale_version"`, and psql shows the version unchanged.
- [ ] `PATCH /api/archive/tournaments/does-not-exist` with a valid `If-Match` returns `404` `"code":"not_found"`.
- [ ] `POST /api/archive/tournaments/<TID>/rounds` with the current `If-Match` returns `200`, and the response body's last `rounds[]` entry has an `id` that is a UUID — round ids are minted by the server, never by the client. Keep it as `RID`.
- [ ] `POST /api/archive/tournaments/<TID>/rounds/<RID>/import` with `{"text":"Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n2, Carol ,Won 2-0,Dan, Aggro ,Control"}` returns `200`; the imported entry reads `"player1Name":"Carol"` (trimmed) and `playerArchetypes` now contains `Carol` → `Aggro`.
- [ ] `POST /api/archive/tournaments/<TID>/rounds/<RID>/entries` with `{"kind":"bye","id":"ignored-client-id","table":"3","playerName":"Carol","deckArchetype":"Aggro"}` returns `200` and the new entry's `id` is **not** `ignored-client-id` — entry ids are server-owned. Keep the real id as `EID`.
- [ ] `PATCH /api/archive/tournaments/<TID>/rounds/<RID>/entries/<EID>` with a body carrying a *different* `"id"` returns `200` and the stored entry still has `EID` — the route id wins.
- [ ] `POST /api/archive/tournaments/<TID>/rounds/<RID>/replace` with **no** `entries` key returns `400` `"code":"validation_failed"` and does not bump the version.
- [ ] `DELETE /api/archive/tournaments/<TID>/rounds/does-not-exist` and `DELETE /api/archive/tournaments/<TID>/rounds/<RID>/entries/does-not-exist` both return `404` `"code":"not_found"`.
- [ ] `PATCH /api/archive/tournaments/<TID>/season` with `{"seasonId":"<SID>"}` returns `200` and `"seasonId":"<SID>"`. Then `{"seasonId":null}` returns `200` and `"seasonId":null`. After the detach, psql shows both `season_id` and `document ->> 'seasonId'` NULL on that row — the column and the stored JSON always move together.
- [ ] After each of those two moves, re-check the counters on the old and the new Season with the psql query above. Both are recomputed, and **neither Season's `version` moves**.
- [ ] `PATCH /api/archive/tournaments/<TID>/season` with `{"seasonId":"does-not-exist"}` returns `404` `not_found`; with `{"seasonId":"   "}` it returns `400` `validation_failed`.
- [ ] Note the current version of a Tournament under `SID`, then `POST /api/archive/tournaments/<that id>/edit-batch` with `{"moveToSeason":{"seasonId":"<SID2>"},"editTournament":{"name":"Batch","tournamentDate":"'"$TODAY"'"},"addRounds":[],"deleteRoundIds":[],"replaceRounds":[],"updateArchetypes":[]}` and the matching `If-Match`. It returns `200`, and `tournament.documentVersion` is the previous version **plus exactly one** even though the batch both edited and moved. Counters on `SID` and `SID2` are both recomputed and neither Season version moved.
- [ ] `POST /api/archive/tournaments/<TID>/edit-batch` with every array empty and every optional null returns `400` `validation_failed` and does not bump the version.
- [ ] `POST /api/archive/tournaments/<TID>/edit-batch` with the same round id in both `deleteRoundIds` and `replaceRounds` returns `400` `validation_failed`, and psql shows the `document` and `version` byte-identical to before — a failed batch writes nothing.
- [ ] `POST /api/archive/tournaments/<TID>/players/rename` with `{"fromName":"Carol","toName":"Caroline"}` renames the player **only inside that Tournament**; a second Tournament that also has a `Carol` still reads `Carol`.
- [ ] `DELETE /api/archive/tournaments/<TID>` with the current `If-Match` returns `200` with `"deleted":true`. psql shows the row still present with a non-NULL `deleted_at`, and the owning Season's counters dropped accordingly. Repeating the DELETE returns `404`.
- [ ] **Lock, as an Organizer:** `POST /api/archive/tournaments` with `"tournamentDate":"'"$OLD"'"` returns `409` with `"code":"archive_tournament_locked"` and inserts nothing. The same call with `"tournamentDate":"'"$EDGE"'"` returns `201` — exactly 365 days old is still open, 366 is frozen.
- [ ] **Lock, as an Admin:** the same `$OLD` create with `$TOKEN` returns `201`. Keep the id as `OLDID`.
- [ ] As an **Organizer**, try each of these on `OLDID` with a correct `If-Match`: `PATCH /`, `PATCH /season`, `DELETE /`, `POST /rounds`, `DELETE /rounds/{r}`, `POST /rounds/{r}/import`, `POST /rounds/{r}/replace`, `POST /rounds/{r}/entries`, `PATCH /rounds/{r}/entries/{e}`, `DELETE /rounds/{r}/entries/{e}`, `PATCH /archetypes/{name}`, `POST /edit-batch`, `POST /players/rename`. All thirteen return `409` `"code":"archive_tournament_locked"`, and psql shows the `document`, `version` and `deleted_at` unchanged.
- [ ] The same `PATCH /api/archive/tournaments/<OLDID>` as an **Admin** returns `200` and bumps the version — Admin bypasses the lock and nothing else.
- [ ] As an **Organizer**, `PATCH /api/archive/tournaments/<TID>` with `"tournamentDate":"'"$OLD"'"` on a Tournament dated today returns `409` `archive_tournament_locked` and the stored date is unchanged — you cannot back-date a row into the frozen window. As an Admin the same call returns `200`.
- [ ] **Restore:** `POST /api/archive/restore` with `Idempotency-Key: r1` and a body `{"kind":"archive","version":5,"leagues":[{"id":"src-l","name":"Ligue importée","createdAt":"'"$TODAY"'"}],"leagueSeasons":[{"id":"src-s","name":"Saison importée","leagueId":"src-l","status":"completed"}],"tournaments":[{"id":"src-t","name":"Manche importée","seasonId":"src-s","tournamentDate":"'"$TODAY"'","status":"completed","rounds":[{"id":"src-r","entries":[{"kind":"match","id":"src-e","table":"1","player1Name":"Alice","player2Name":"Bob","player1Score":2,"player2Score":1,"player1DeckArchetype":"Tempo","player2DeckArchetype":"Control"}]}],"playerArchetypes":[]}]}` returns `201`. Every returned `id` differs from its `sourceId`, the stored Season points at the **new** League id, the stored Tournament points at the **new** Season id, and psql shows fresh UUIDs for the round and entry ids inside `document`.
- [ ] The restored Season's counters are stamped: `tournament_count` `1`, non-null date bounds, `counts_version` `1`, `version` `1`.
- [ ] Restore that same bundle again with a **different** `Idempotency-Key`. The second run's League and Season names are `Ligue importée (restored)` and `Saison importée (restored)` — a name collision is uniquified, not rejected.
- [ ] Replay the first bundle with `Idempotency-Key: r1`. It returns the identical `201` payload and inserts nothing new. Sending a **different** body with `Idempotency-Key: r1` returns `409` `idempotency_conflict`.
- [ ] `POST /api/archive/restore` with `"version":4` returns `400` `validation_failed`; with `"kind":"fullArchive"` it returns `400`; with a `tournaments[].seasonId` that names no Season in the bundle it returns `400`; with a Tournament that has no `rounds` key it returns `400`. None of them insert anything.
- [ ] A bundle whose Tournament is dated 1000 days ago restores with `201` **as an Organizer** — restore is the historical-import path and is deliberately exempt from the 365-day lock.
- [ ] `POST /api/archive/restore-full` with `"kind":"fullArchive"` as an **Organizer** returns `403` `forbidden`; the same call as an **Admin** returns `201`. A bundle with 101 leagues returns `400` `validation_failed`.
- [ ] Confirm the legacy surface is untouched: run an archive create and a round add on the new routes, then check `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select document_id, version from league_archive_aggregates order by document_id;'` — the row count and every version are exactly what they were before.
- [ ] Open `/leagues-archive` in the browser, create an archive League with Power User mode on, open a Tournament detail page, then load `/global-stats`, a Live tournament and `/events`. Everything renders as before with no error toast and no red DevTools console error — this slice adds routes beside the old ones and changes none of them.

## T5 whole-catalog-reads

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


Both routes are anonymous public GETs, so no token is needed to read them. Creating the rows to read
does need an Organizer token — reuse `$TOKEN` and the T3/T4 command routes from the sections above.
Use `curl -sS -D - -o /dev/null <url>` to see headers: `curl -I` sends `HEAD`, which this app leaves
unmapped and answers `405` on every route, so a `-I` check is vacuously green.

- [ ] Against the empty archive, `curl -sS -i http://127.0.0.1:5080/api/archive/leagues/all` returns `200` with the body `{"items":[],"totalCount":0,"truncated":false}`, a `cache-control: public, max-age=3600` and an `etag:` of 64 hex characters inside double quotes. The same holds for `http://127.0.0.1:5080/api/archive/league-seasons/all`. An empty archive is a valid answer, never a `404`.
- [ ] The two ETags from the previous step **differ** even though both bodies are the empty catalog. The routes must not share an ETag namespace, or a client holding one would be answered `304` for the other.
- [ ] Create two Leagues (`Ligue A`, then `Ligue B`) and two Seasons under them with the T3 routes. `GET /api/archive/leagues/all` now returns `totalCount` `2` and lists the **most recently updated first** — `Ligue B` before `Ligue A`. Rename `Ligue A`; it moves to the front on the next read.
- [ ] A League row carries exactly the keys `id`, `name`, `createdAt`, `updatedAt`, `documentVersion` — nothing else. A Season row carries exactly `id`, `name`, `leagueId`, `status`, `updatedAt`, `documentVersion`, `tournamentCount`, `playerCount`, `firstTournamentDate`, `lastTournamentDate`. Check with `curl -sS http://127.0.0.1:5080/api/archive/league-seasons/all | python3 -m json.tool`.
- [ ] No row on either route carries `rounds`, `playerArchetypes`, `tournaments` or `document`. The catalog is cached whole in the browser, so a document sneaking onto a row is the bug this check exists to catch: `curl -sS http://127.0.0.1:5080/api/archive/league-seasons/all | grep -c 'playerArchetypes\|rounds\|"document"'` prints `0`.
- [ ] A brand-new Season reads `"tournamentCount":0`, `"playerCount":0`, `"firstTournamentDate":null`, `"lastTournamentDate":null`. The two dates are the only nullable fields and they are null together.
- [ ] **ETag freshness — the load-bearing one.** Read and keep the `etag:` of `/api/archive/league-seasons/all`. Now add a Tournament to one of the Seasons with the T4 routes. Confirm in psql that the Season row itself did **not** move: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select version, updated_at, tournament_count, player_count from archive_league_seasons where document_id = '<SID>';"` shows the same `version` and `updated_at` as before but a higher `tournament_count`. Re-read the catalog: `tournamentCount` reflects the new Tournament **and the `etag:` has changed**. An ETag that only watched the newest row's stamp would have served the stale counters behind a `304` for a full hour.
- [ ] Replay that read with the **old** ETag: `curl -sS -i -H 'If-None-Match: <old etag>' http://127.0.0.1:5080/api/archive/league-seasons/all` returns `200` with the fresh body, not `304`.
- [ ] Replay it with the **current** ETag: it returns `HTTP/1.1 304 Not Modified` with an empty body, and the `304` still carries both `etag:` and `cache-control: public, max-age=3600`.
- [ ] Soft-delete one League and one Season with the T3 `DELETE` routes. Neither appears in `items` on its catalog **and** `totalCount` drops by one on each. psql still shows both rows present with a non-NULL `deleted_at` — a soft delete hides the row from the catalog without removing it.
- [ ] `curl -sS -D - -o /dev/null -H 'Accept-Encoding: br' http://127.0.0.1:5080/api/archive/league-seasons/all` answers `content-encoding: br`, and the decoded body equals the body of the same request sent without `Accept-Encoding`.
- [ ] The same request plus `-H 'Authorization: Bearer x'` answers with **no** `content-encoding` header, and so does the same request plus `-H 'Cookie: gones_refresh=x'`. Compressing a body next to a session secret is the BREACH side channel (ADR 0042), so a credentialed read is never compressed even on an anonymous route.
- [ ] Unknown query parameters are ignored, not rejected: `curl -sS -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5080/api/archive/leagues/all?page=2&sort=name'` prints `200` and the body is the whole catalog.
- [ ] **Truncation** (needs a restart, so run it last): stop the api container, bring it back with `GONES_FEATURES__AUTH_V1=$GONES_FEATURES__AUTH_V1 docker compose run --rm -e Gones__Archive__MaximumLeagueCatalogSize=1 -p 127.0.0.1:5081:8080 api`, then `curl -sS http://127.0.0.1:5081/api/archive/leagues/all` returns exactly `1` item with `"truncated":true` while `totalCount` stays at the full visible count. Stop that container and `docker compose up -d api` to restore the stack.
- [ ] Confirm the legacy surface is untouched: `curl -sS -D - -o /dev/null http://127.0.0.1:5080/api/leagues-archive/all` still answers `200` with its own `etag:` and `cache-control: public, max-age=3600` and its own rows. Then open `/leagues-archive` in the browser, open a Tournament detail page, and load `/global-stats`, `/events` and a Live tournament. Everything renders as before with no error toast and no red DevTools console error — this slice only adds two routes beside the old ones.

## T6 year-partitioned-tournaments

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


Both routes are anonymous public GETs, so no token is needed to read them. Creating the Tournaments to
read needs an Organizer token — reuse `$TOKEN` and the T3/T4 command routes from the sections above.
Use `curl -sS -D - -o /dev/null <url>` to see headers: `curl -I` sends `HEAD`, which this app leaves
unmapped and answers `405` on every route, so a `-I` check is vacuously green.

- [ ] Against the empty archive, `curl -sS -i 'http://127.0.0.1:5080/api/archive/tournaments/all?year=2026'` returns `200` with the body `{"items":[],"totalCount":0,"truncated":false}`, a `cache-control: public, max-age=3600` and an `etag:` of 64 hex characters inside double quotes. An empty year is a valid cacheable answer, never a `404`.
- [ ] Against the empty archive, `curl -sS -i http://127.0.0.1:5080/api/archive/years` returns `200` with exactly `{"years":[]}` plus the same two caching headers. `years` is an empty list, never `null`.
- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/tournaments/all` (no query string at all) returns `400`, `content-type: application/problem+json`, `"code":"invalid_request"` and `"message":"Query parameter 'year' is required."`. There is no all-years mode — a missing year is an error, not a request for the whole table.
- [ ] The same call with `?year=` (blank) returns the identical `400` and the identical `required` message.
- [ ] `?year=abc`, `?year=0`, `?year=10000` and `?year=-2031` each return `400` with `"code":"invalid_request"` and `"message":"Query parameter 'year' must be an integer between 1 and 9999."`. Note `invalid_request` is snake_case like every other code in this API.
- [ ] Create four Tournaments with the T4 routes: two dated in the **current** year, one dated `<current year - 1>-06-01`, and one dated `<current year>-03-05` sharing its date with one of the first two. `GET /api/archive/tournaments/all?year=<current year>` returns only the current-year rows and `totalCount` counts only them — the other year must not leak into the body.
- [ ] In that same body the rows are ordered **newest `tournamentDate` first**, and the two rows sharing `<current year>-03-05` are ordered by their `id` ascending. Repeat the call: the order is byte-identical, because the id tiebreak makes it total.
- [ ] A row carries exactly the keys `id`, `name`, `seasonId`, `tournamentDate`, `status`, `updatedAt`, `documentVersion`, `playerCount` — nothing else. Check with `curl -sS 'http://127.0.0.1:5080/api/archive/tournaments/all?year=<current year>' | python3 -m json.tool`.
- [ ] **The lock asymmetry — the load-bearing one.** No Tournament row carries a `locked` key: `curl -sS 'http://127.0.0.1:5080/api/archive/tournaments/all?year=<current year>' | grep -c locked` prints `0`. But every entry of `curl -sS http://127.0.0.1:5080/api/archive/years` **does** carry `locked`. A row cached today as unlocked would silently become locked with no refetch, so the client derives that flag from `tournamentDate`; the years index is refetched every session and carries the day in its ETag, so it can serve the flag safely.
- [ ] No row carries `rounds`, `playerArchetypes` or `document`: `curl -sS 'http://127.0.0.1:5080/api/archive/tournaments/all?year=<current year>' | grep -c 'rounds\|playerArchetypes\|"document"'` prints `0`. Catalog rows are cached whole in the browser; the detail document is a different route.
- [ ] `tournamentDate` is a plain ISO string such as `"2026-03-05"`, not an object — the client parses it directly to derive the lock flag.
- [ ] A Tournament created with no `seasonId` reads `"seasonId":null`; one created under a Season reads that Season's id. `seasonId` is the only nullable field on the row.
- [ ] `playerCount` matches the number of distinct players in that Tournament's standings, and stays correct after you add a round — it is read off the denormalized `player_count` column, never derived from the stored JSON on this route.
- [ ] `GET /api/archive/years` lists one entry per year that holds at least one visible Tournament, **ascending by year**, with no entry for a year that holds none. The `tournamentCount` of each entry matches the `totalCount` the year partition reports for the same year.
- [ ] Create a Tournament dated more than 366 days ago (Admin token — an Organizer is refused by the T4 lock). Its year appears in `/api/archive/years` with `"locked":true`, while the current year reads `"locked":false`. A year is locked when its 31 December is more than 365 days old, because that is the newest date any row in the year can carry.
- [ ] **Per-year ETag isolation.** Keep the `etag:` of `?year=<current year>` and of `?year=<current year - 1>`. The two differ. Now add one Tournament to the **current** year. Re-read both: the current year's `etag:` changed and the previous year's is **byte-identical**. This is the whole point of partitioning — a write in one year must leave every other year revalidating for free.
- [ ] Replay a year read with its **current** ETag: `curl -sS -i -H 'If-None-Match: <etag>' 'http://127.0.0.1:5080/api/archive/tournaments/all?year=<current year>'` returns `HTTP/1.1 304 Not Modified` with an empty body, and the `304` still carries both `etag:` and `cache-control: public, max-age=3600`. Replay with the **stale** ETag and it returns `200` with the fresh body.
- [ ] Do the same pair of replays against `/api/archive/years`: the current ETag gives `304` with both headers, a stale one gives `200`.
- [ ] Soft-delete one Tournament with the T4 `DELETE` route. It disappears from its year's `items`, its year's `totalCount` drops by one, **and** that year's `tournamentCount` in `/api/archive/years` drops by one. psql still shows the row present with a non-NULL `deleted_at`. If it was the year's only row, the year disappears from the index entirely.
- [ ] Unknown query parameters are ignored, not rejected: `curl -sS -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5080/api/archive/tournaments/all?year=2026&page=2&sort=name'` prints `200`.
- [ ] `curl -sS -D - -o /dev/null -H 'Accept-Encoding: br' 'http://127.0.0.1:5080/api/archive/tournaments/all?year=<current year>'` answers `content-encoding: br`; the same request with `-H 'Authorization: Bearer x'` answers with **no** `content-encoding`. Compressing a body next to a session secret is the BREACH side channel (ADR 0042).
- [ ] **Truncation** (needs a restart, so run it last): stop the api container, bring it back with `GONES_FEATURES__AUTH_V1=$GONES_FEATURES__AUTH_V1 docker compose run --rm -e Gones__Archive__MaximumTournamentYearSize=1 -p 127.0.0.1:5081:8080 api`, then `curl -sS 'http://127.0.0.1:5081/api/archive/tournaments/all?year=<current year>'` returns exactly `1` item with `"truncated":true` while `totalCount` stays at the full visible count for that year. Raise the cap to the exact number of rows in that year and `truncated` reads `false` — a year that ends exactly on the ceiling is whole, not cut short. Stop that container and `docker compose up -d api` to restore the stack.
- [ ] Confirm the legacy and sibling surfaces are untouched: `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/api/leagues-archive/all`, `.../api/archive/leagues/all` and `.../api/archive/league-seasons/all` all print `200`. Then open `/leagues-archive` in the browser, open a Tournament detail page, and load `/global-stats`, `/events` and a Live tournament. Everything renders as before with no error toast and no red DevTools console error — this slice only adds two routes beside the old ones and changes no component.

## T7 read-through-and-detail

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


All four routes are anonymous public GETs, so no token is needed to read them. Creating the Season and
the Tournaments to read needs an Organizer token — reuse `$TOKEN` and the T3/T4 command routes from the
sections above. Use `curl -sS -D - -o /dev/null <url>` to see headers: `curl -I` sends `HEAD`, which
this app leaves unmapped and answers `405` on every route, so a `-I` check is vacuously green.

Set up once: create a League, a Season `$SID` under it, and three Tournaments under `$SID` dated
`<current year>-03-01`, `<current year>-08-17` and `<current year>-05-01`; plus one standalone
Tournament (no `seasonId`) and one Tournament under a **second** Season. Give the two Season
Tournaments you keep at least one round each with real match results, so the standings have something
to compute.

- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/league-seasons/$SID/tournaments` returns `200`, a `cache-control: public, max-age=60` and an `etag:` of 64 hex characters inside double quotes. **One minute, not the catalogs' hour**: compare against `curl -sS -D - -o /dev/null http://127.0.0.1:5080/api/archive/league-seasons/all`, which still reads `max-age=3600`. These four bodies are what the client reads when it is looking straight at a Tournament, so an hour-long HTTP cache would hide an edit behind a request that never reaches the server.
- [ ] In that body the rows are ordered **newest `tournamentDate` first**, `totalCount` equals the number of visible Tournaments in the Season, and `truncated` is `false`. Repeat the call: the body is byte-identical.
- [ ] A row carries exactly the keys `id`, `name`, `seasonId`, `tournamentDate`, `status`, `updatedAt`, `documentVersion`, `playerCount` — nothing else. Check with `curl -sS http://127.0.0.1:5080/api/archive/league-seasons/$SID/tournaments | python3 -m json.tool`.
- [ ] No row carries `rounds`, `playerArchetypes`, `document` or `locked`: `curl -sS http://127.0.0.1:5080/api/archive/league-seasons/$SID/tournaments | grep -c 'rounds\|playerArchetypes\|"document"\|locked' ` prints `0`. A catalog row is not a detail document, and `locked` is derived client-side from `tournamentDate` because a row cached today as unlocked becomes locked later with no refetch.
- [ ] The standalone Tournament and the Tournament under the second Season **do not** appear in `items`, and neither is counted in `totalCount`. Membership is `season_id = $SID` exactly; a standalone Tournament belongs to no Season's read-through.
- [ ] Soft-delete one of the Season's Tournaments with the T4 `DELETE` route. It disappears from `items` and `totalCount` drops by one. psql still shows the row present with a non-NULL `deleted_at`: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select document_id, deleted_at from archive_tournaments where season_id = '$SID';"`.
- [ ] Create a second Season and leave it empty. `curl -sS -i http://127.0.0.1:5080/api/archive/league-seasons/<empty SID>/tournaments` returns `200` with `{"items":[],"totalCount":0,"truncated":false}` plus both caching headers. An existing but empty Season is a valid cacheable answer, never a `404`.
- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/league-seasons/does-not-exist/tournaments` returns `404` with `content-type: application/problem+json` and `"code":"not_found"` — snake_case, like every other code in this API. Soft-delete a Season with the T3 `DELETE` route and confirm its read-through answers `404` too.
- [ ] `curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5080/api/archive/league-seasons/%20/tournaments"` prints `400`, and the body carries `"code":"validation_failed"` with `errors.seasonId[0]` reading `Value must contain 1 to 200 characters.`. Repeat with a 201-character id (`python3 -c "print('x'*201)"`) — also `400`. A malformed id is a bad request, not a missing resource: `404` would say the id was merely unknown and invite a retry with the same broken value.
- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/tournaments/<TID>` (one of the Season's Tournaments) returns `200` with the **whole** document: `rounds` with their entries and `playerArchetypes` are both present, alongside `id`, `name`, `seasonId`, `tournamentDate`, `status`, `documentVersion` and `updatedAt`. This is the only route that serves Rounds — a detail document is never stored in a year partition.
- [ ] `tournamentDate` on the detail body is a plain ISO string such as `"2026-08-17"`, not an object, exactly as on a catalog row.
- [ ] The standalone Tournament's detail body reads `"seasonId":null` — serialized, never omitted and never `""`.
- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/tournaments/does-not-exist` returns `404` with `application/problem+json`, and so does the detail route for the Tournament you soft-deleted above.
- [ ] The detail `etag:` is a short quoted base64 value (for example `"AAAAAAAAAAE="`), **not** a 64-hex hash: it is `StrongETag.Encode(version)`, the same token the T4 `PATCH`/`DELETE` routes accept as `If-Match`. Confirm it round-trips: read the detail, then send that exact value as `If-Match` on a T4 rename of the same Tournament — it succeeds rather than answering `412 stale_version`.
- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/tournaments/<TID>/result` returns `200` with `"scope":"tournament"` and one `rows` entry per player in that Tournament's standings, ranked. Compare against the same Tournament rendered in the legacy `/leagues-archive` UI — the ranking rows match.
- [ ] `curl -sS -i http://127.0.0.1:5080/api/archive/league-seasons/$SID/result` returns `200` with **`"scope":"season"`, not `"league"`**. Under the three-tier vocabulary `League` names the top tier, so a Season's standings labelled `"league"` would be actively wrong.
- [ ] In that Season result, `startDate` and `endDate` are the earliest and latest `tournamentDate` of the Season's **visible** Tournaments, and a player who played in two of them shows `playedMatchCount` counting both. The Tournament you soft-deleted contributes nothing, and neither does the standalone one nor the one under the second Season.
- [ ] The empty Season's result (`/api/archive/league-seasons/<empty SID>/result`) returns `200` with `"rows":[]`, `"startDate":""`, `"endDate":""` and `"incomplete":false`. Empty strings, not `null`.
- [ ] `/api/archive/tournaments/does-not-exist/result`, `/api/archive/league-seasons/does-not-exist/result` and the soft-deleted Season's `/result` each return `404`.
- [ ] **The two Season ETags must differ — the load-bearing one.** Read the `etag:` of `/api/archive/league-seasons/$SID/tournaments` and of `/api/archive/league-seasons/$SID/result`. They are different values. Now replay the **result** route with the **row-list** ETag as `If-None-Match`: it returns `200` with the standings body, **not** `304`. Without separate ETag namespaces a client holding the row-list ETag would be answered `304` and go on rendering a standings body it never received.
- [ ] Replay each of the four routes with its **own current** ETag: `curl -sS -i -H 'If-None-Match: <etag>' <url>` returns `HTTP/1.1 304 Not Modified` with an empty body, and the `304` still carries both `etag:` and `cache-control: public, max-age=60`. Replay each with a stale ETag and it returns `200` with the fresh body.
- [ ] **An edit moves every affected ETag.** Keep all four ETags. Rename one of the Season's Tournaments with the T4 `PATCH`. Re-read: that Tournament's detail ETag, its result ETag, the Season read-through ETag **and** the Season result ETag have all changed. A rename that left the row count alone must still move the list stamp, or the client keeps rendering the old name for the whole TTL.
- [ ] Unknown query parameters are ignored, not rejected: `curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5080/api/archive/league-seasons/$SID/tournaments?page=2&sort=name"` prints `200`.
- [ ] `curl -sS -D - -o /dev/null -H 'Accept-Encoding: br' http://127.0.0.1:5080/api/archive/league-seasons/$SID/tournaments` answers `content-encoding: br`; the same request with `-H 'Authorization: Bearer x'` answers with **no** `content-encoding`. Compressing a body next to a session secret is the BREACH side channel (ADR 0042).
- [ ] **Truncation** (needs a restart, so run it last): stop the api container, bring it back with `GONES_FEATURES__AUTH_V1=$GONES_FEATURES__AUTH_V1 docker compose run --rm -e Gones__Archive__MaximumSeasonTournamentSize=1 -p 127.0.0.1:5081:8080 api`, then `curl -sS http://127.0.0.1:5081/api/archive/league-seasons/$SID/tournaments` returns exactly `1` item — the newest — with `"truncated":true` while `totalCount` stays at the full visible count for the Season. Raise the cap to the exact number of visible rows and `truncated` reads `false`: a Season that ends exactly on the ceiling is whole, not cut short. Stop that container and `docker compose up -d api` to restore the stack.
- [ ] Confirm the legacy and sibling surfaces are untouched: `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/api/leagues-archive/all`, `.../api/archive/leagues/all`, `.../api/archive/league-seasons/all`, `'.../api/archive/tournaments/all?year=<current year>'` and `.../api/archive/years` all print `200`, and each of those five still carries `cache-control: public, max-age=3600`. Then open `/leagues-archive` in the browser, open a Tournament detail page, and load `/global-stats`, `/events` and a Live tournament. Everything renders as before with no error toast and no red DevTools console error — this slice only adds four routes beside the old ones and changes no component.

## T8 scoped-player-statistics

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


Both new routes are anonymous public GETs, so no token is needed to read them. Creating the Leagues,
Seasons and Tournaments whose numbers you are checking needs an Organizer token — reuse `$TOKEN` and
the T3/T4 command routes from the sections above. Use `curl -sS -D - -o /dev/null <url>` to see
headers: `curl -I` sends `HEAD`, which this app leaves unmapped and answers `405` on every route, so a
`-I` check is vacuously green.

Set up once: one League `$LID` holding two Seasons `$S1` and `$S2`, plus one **standalone** Tournament
(no `seasonId`). Under `$S1` put two completed Tournaments in which the same player — call them
`Alice` — wins every match against `Bob`. Under `$S2` put one completed Tournament in which `Alice`
**loses** to `Bob`. In the standalone Tournament let `Alice` beat a player who appears nowhere else —
call them `Dana`. That shape is what makes a per-scope replay distinguishable from a filtered global
number, and it gives the standalone rule a witness.

- [ ] `curl -sS -D - -o /dev/null http://127.0.0.1:5080/api/archive/global-player-statistics` returns `200` with `cache-control: public, max-age=3600` and an `etag:` of 64 hex characters inside double quotes.
- [ ] With no `scopeKind` at all the route answers the **global** scope: `curl -sS http://127.0.0.1:5080/api/archive/global-player-statistics | python3 -m json.tool` lists `Alice`, `Bob` and `Dana`, and `totalCount` counts every player in the whole archive.
- [ ] `curl -sS "http://127.0.0.1:5080/api/archive/global-player-statistics?scopeKind=league&scopeId=$LID"` returns `200`. `Alice`'s `playedMatchCount` and `tournamentsPlayed` here are **smaller** than in the global body, and her `rating` is a **different number** — not the global rating filtered down. Write both ratings on paper before comparing.
- [ ] `curl -sS "http://127.0.0.1:5080/api/archive/global-player-statistics?scopeKind=season&scopeId=$S2"` shows `Alice` with `rating` **below 1500** — she only lost in that Season — while the global body shows her above 1500. A scope is a fresh Glicko-2 replay from the published seed, so a player can be strong globally and weak in one Season.
- [ ] In that same `$S2` body `Alice`'s `tournamentsPlayed` is `1` and `provisional` is `true`, while in the global body she is `provisional: false` if she played five or more Tournaments overall. The same player is provisional in one scope and ranked in another; that is the intended behaviour, not a bug.
- [ ] **The standalone rule.** `Dana` appears in the global body and in **no** League or Season body: `curl -sS "http://127.0.0.1:5080/api/archive/global-player-statistics?scopeKind=league&scopeId=$LID" | grep -c Dana` prints `0`, and so does the same grep against both Season scopes. A Tournament with no Season belongs to no League.
- [ ] **An unknown scope id is a `200`, never a `404`.** `curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5080/api/archive/global-player-statistics?scopeKind=season&scopeId=no-such-season"` prints `200`, and the body is `{"items":[], … "totalCount":0, "page":1 …}`. The scope is a filter over stored rows, not a resource; a `404` would tell a client the Season does not exist when it may simply have no completed Match yet.
- [ ] The same holds on the catalog: `curl -sS "http://127.0.0.1:5080/api/archive/global-player-statistics/all?scopeKind=league&scopeId=nope"` returns `200` with `"items":[]`, `"totalCount":0` and `"truncated":false`.
- [ ] `scopeId` is ignored on the global scope: the body of `?scopeKind=global&scopeId=$LID` is byte-identical to the body with no query string at all. Compare with `diff <(curl -sS "http://127.0.0.1:5080/api/archive/global-player-statistics?scopeKind=global&scopeId=$LID") <(curl -sS http://127.0.0.1:5080/api/archive/global-player-statistics)` — it prints nothing.
- [ ] `curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5080/api/archive/global-player-statistics?scopeKind=continent"` prints `400`, and the body carries `"code":"validation_failed"` — snake_case, like every other code in this API — with `errors.scopeKind[0]` reading `Scope kind must be global, league, or season.`
- [ ] `?scopeKind=league` with no `scopeId` prints `400` with `errors.scopeId[0]` reading `Scope id is required for a league or season scope.` A 201-character `scopeId` (`python3 -c "print('x'*201)"`) also prints `400`.
- [ ] **Each scope caches under its own ETag — the load-bearing one.** Read the `etag:` of the global body and of the `$LID` League body: they differ. Replay each with its own value as `If-None-Match` and each returns `304 Not Modified` with an empty body and both caching headers still present. Now replay the **League** URL with the **global** ETag: it returns `200` with the League body, not `304`. Without the scope in the ETag input a client holding one scope's validator would be told nothing changed and go on rendering another scope's numbers.
- [ ] Every allowlisted `sort` answers `200` in both directions inside a scope. Spot-check the new short names against the long ones: `?scopeKind=league&scopeId=$LID&sort=matches&direction=asc` and `&sort=playedMatchCount&direction=asc` return the same row order, and so do `sort=wins`/`matchWins`, `sort=losses`/`matchLosses`, `sort=winrate`/`matchWinrate`, `sort=tournaments`/`tournamentsPlayed`. `sort=name` orders by Player Name. `sort=continent` prints `400`.
- [ ] **The legacy rankings still show one row per player.** `curl -sS http://127.0.0.1:5080/api/leagues-archive/global-player-statistics | python3 -m json.tool` lists `Alice` exactly once and its `totalCount` equals the global body's, even though psql shows several times that many rows: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select scope_kind, scope_id, count(*) from player_statistics group by 1,2 order by 1,2;"`. Same for `/api/leagues-archive/global-player-statistics/all`.
- [ ] `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/api/players/Alice` prints `200` and the body's `statistics.rating` equals the **global** rating, not a League one. Before this slice that query matched one row; it now has to pick the global partition or it would throw and answer `500`.
- [ ] **The scope invariant holds in the table.** `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "SELECT count(*) FROM player_statistics WHERE (scope_kind = 'global') <> (scope_id = '');"` prints `0`. A League or Season row always names its scope; only the global scope uses the empty id.
- [ ] **The schema is re-keyed.** `docker compose exec -T postgres psql -U gones_migration -d gones -c "\d player_statistics"` shows `scope_kind` and `scope_id` as `text not null`, a primary key `btree (scope_kind, scope_id, player_name)`, and a check constraint `ck_player_statistics_scope_kind` restricting `scope_kind` to `global`, `league`, `season`. Confirm the migration is applied: the `__EFMigrationsHistory` table ends with `20260822220652_ScopePlayerStatistics`.
- [ ] **The startup rebuild ran.** `docker compose logs api | grep 'Player statistics rebuilt'` shows a line reading `Player statistics rebuilt: N rows across M scopes in … ms.` — the new wording — with `M` equal to 1 (global) plus one per League and one per Season that has a contributing Tournament.
- [ ] **Idempotence.** Restart the api container twice and re-read the global body each time: `totalCount`, every `rating` and the `etag:` are unchanged. Two rebuilds on the same day must agree exactly.
- [ ] Confirm nothing else moved: `curl -sS -o /dev/null -w '%{http_code}\n'` against `http://127.0.0.1:5080/api/leagues-archive/all`, `.../api/archive/leagues/all`, `.../api/archive/league-seasons/all`, `'.../api/archive/tournaments/all?year=<current year>'` and `.../api/archive/years` all print `200`. Then open `/global-stats`, `/leagues-archive`, a player page, `/events` and a Live tournament in the browser: everything renders as before with no error toast and no red DevTools console error. This slice adds two routes beside the old ones and changes no component.

## T9 dev-fixtures

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice is data only — no route changed, no component changed, no i18n key moved. What it buys is
that `npm run dev:env -- --env=demo` populates the three-tier archive through
`POST /api/archive/restore-full`, and that `npm run dev:stress:generate` emits three-tier data instead
of one flat tier. Nothing renders any of it yet; the archive UI arrives at T13/T14. So this pass is
looking at the API and the database, not at pages, plus the *absence* of breakage on the legacy paths
that share the stack.

Start from a running stack: `docker compose up -d --wait postgres migrator api worker`. Use
`curl -sS -D - -o /dev/null <url>` to read headers — `curl -I` sends `HEAD`, which this app leaves
unmapped and answers `405` on every route, so a `-I` check is vacuously green. The local API is
`127.0.0.1:5080`.

- [ ] `npm run dev:env -- --env=demo` exits `0` and its last line reads `Seeded 7 accounts, 2 organizations, 4 formats, 16 Events, 7 registrations, 2 league archives, 8 archive Leagues, 12 archive League Seasons, 48 archive Tournaments, 2 running tournaments.` The three archive counts are the ones this slice added.
- [ ] The same run prints a `Player statistics rebuilt: N rows, API ready again … ms after the restart.` line with `N` in the hundreds. The archive command endpoints carry no write-side rebuild, so the seeder triggers the startup one after the restore; without that line the rankings below will all be empty.
- [ ] **The three tiers landed.** `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT (SELECT count(*) FROM archive_leagues WHERE deleted_at IS NULL), (SELECT count(*) FROM archive_league_seasons WHERE deleted_at IS NULL), (SELECT count(*) FROM archive_tournaments WHERE deleted_at IS NULL), (SELECT count(*) FROM archive_tournaments WHERE season_id IS NULL AND deleted_at IS NULL), (SELECT count(*) FROM archive_league_seasons WHERE tournament_count = 0)"` prints exactly `8|12|48|5|1` — eight Leagues, twelve Seasons, forty-eight Tournaments, five of them standalone, and one deliberately empty Season.
- [ ] **The denormalized Season counters are right.** `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT name, tournament_count, player_count, first_tournament_date, last_tournament_date FROM archive_league_seasons ORDER BY tournament_count DESC LIMIT 3"` puts `1996-97` first with `11|39|1996-09-14|1997-07-12`. That Season is the cross-year case: a free-string label whose Tournaments run September 1996 to July 1997.
- [ ] **No Season claims Tournaments but no dates.** `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT count(*) FROM archive_league_seasons WHERE tournament_count > 0 AND (first_tournament_date IS NULL OR last_tournament_date IS NULL)"` prints `0`.
- [ ] **A standalone Tournament omits the key, it does not write JSON null.** `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT count(*) FROM archive_tournaments WHERE document ? 'seasonId' AND season_id IS NULL"` prints `0`. A JSON null is distinct from SQL NULL and `ck_archive_tournament_document_metadata` would have refused the row.
- [ ] **Statistics cover every tier.** `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT scope_kind, count(DISTINCT scope_id), count(*) FROM player_statistics GROUP BY 1 ORDER BY 1"` prints three rows: `global|1|…`, `league|8|…` and `season|11|…`. Eleven Season scopes and not twelve is correct — the empty Season has no completed Tournament and therefore ranks nobody.
- [ ] **Season names are free strings and are not parsed.** `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT name FROM archive_league_seasons ORDER BY name"` lists `1996-97`, `2025-26`, `Season 5 - Round 2`, `3ª Etapa Regular - 2026/2` and `Liga Sword - Primeira Etapa` among others. None of these is a year column, and nothing in the app may derive one from them.
- [ ] **Known, accepted:** that same list shows `Season 3` / `Season 3 (restored)` and `2026` / `2026 (restored)` / `2026 (restored) 2`. The fixture deliberately gives two different Leagues a Season named `Season 3`, and three Leagues a Season named `2026`, because that is what real archives look like. The restore endpoint uniquifies a colliding Season name **globally rather than per parent League**, so the stored labels differ from the fixture ones. Report it if you think the uniqueness should be scoped to the League — that is a T3/T4 question, not a fixture bug.
- [ ] **Re-seeding is safe.** Run `npm run dev:env -- --env=demo` a second time. It exits `0`, the `8|12|48|5|1` query above prints the same thing, and `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT count(*) FROM archive_leagues WHERE name LIKE '%(restored)%'"` prints `0` — no League name drifted.
- [ ] **The legacy path survived.** `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/api/live-tournaments` prints `200` and `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT name, canonical_document::jsonb ->> 'leagueId' FROM live_aggregates ORDER BY name"` shows `Gones League 7 - Day 2` and `Local Live Demo` each naming a League id, `Lyon Legacy Weekly` naming none. `POST /api/live-tournaments` still resolves `leagueId` against the *legacy* `league_archive_aggregates` table, so an empty column here means the legacy fixture path broke.
- [ ] `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT count(*) FROM league_archive_aggregates WHERE document_id = 'placeholder-league'"` prints `1`. `scripts/seed-local.mjs` throws `Fixed placeholder League missing or duplicated.` without that row, which would break `npm run db:reset`.
- [ ] **Known, accepted:** the demo archive double-counts in the `global` rankings scope, because that scope folds in both `archive_tournaments` and the legacy `league_archive_aggregates`, and `demo` carries four Tournaments in the legacy tier. Dev-only, and it disappears when the legacy surface is retired. Do not report it.
- [ ] **The generator is byte-deterministic.** `npm run dev:stress:generate -- --seed=1 && sha256sum fixtures/dev-environments/stress/archive-*.json > /tmp/a && npm run dev:stress:generate -- --seed=1 && sha256sum fixtures/dev-environments/stress/archive-*.json > /tmp/b && diff /tmp/a /tmp/b && echo DETERMINISTIC` prints `DETERMINISTIC` and exits `0`. The generator reads no clock; if this ever diverges, something started calling `Date.now()`.
- [ ] The same run's summary reads `62 archive Leagues, 186 League Seasons, 2180 Tournaments (120 standalone, 276510 Round Entries)` and, on the next line, `6 legacy League references for the running tournaments`. `leagues.json` is now Live reference stubs only — the full legacy archive beside a three-tier one would be 44 MB of duplicate history.
- [ ] `git status --porcelain fixtures/dev-environments/stress/` prints nothing. The generated files are gitignored and must never be committed.
- [ ] **The golden bundle is stamped.** `node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');const t=readFileSync('fixtures/archive-domain/v5/bundle.json','utf8');const m=JSON.parse(readFileSync('fixtures/archive-domain/v5/manifest.json','utf8'));console.log(createHash('sha256').update(t).digest('hex')===m.bundleSha256?'STAMPED':'DRIFT')"` prints `STAMPED`. Edit any of the three `demo` archive fixture files and this must print `DRIFT` until the bundle and hash are regenerated — the regeneration commands are in `fixtures/dev-environments/README.md`.
- [ ] **The fixture archive ages, and that is by design.** It is dated against the declared anchor `2026-08-22`; the newest Tournament is `2026-07-11`. Twenty-four of the forty-eight are past the 365-day lock window and twenty-four are not. Past roughly mid-2027 every one of them locks and the unlocked path stops being reachable in dev, at which point the dates are bumped forward and `fixtures/archive-domain/v5/` regenerated. Do not report the ageing as a bug before that date.
- [ ] Confirm nothing else moved: open `/events`, `/leagues-archive`, `/global-stats`, a player page and a Live tournament in the browser. Everything renders as before, with no error toast and no red DevTools console error. This slice touches no file under `src/app/`, `backend/`, `cypress/` or `docs/`.

## T9b archive-write-statistics-rebuild

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice is backend only — no route added, no request or response shape changed, no component and no
i18n key touched. What it buys is that a write through `/api/archive/**` leaves `player_statistics`
consistent inside the same transaction, the way the legacy `/api/leagues-archive/**` surface already
did. Before it, every archive create, edit, delete, move and restore left the rankings stale until the
API process next restarted.

So this pass is looking at the database **immediately after an HTTP write, with no container restart in
between** — a restart runs the startup repair and would make every check below vacuously green. Do not
`docker compose restart api` anywhere in this section.

Start from a running stack on the demo data: `docker compose up -d --wait postgres migrator api worker`,
then `npm run dev:env -- --env=demo`. The local API is `127.0.0.1:5080`; `HEAD` is unmapped app-wide, so
read headers with `curl -sS -D - -o /dev/null <url>` and never `curl -I`. Set up a shell first — the
token expires, so re-run the first line if a write starts answering `401`:

```bash
TOKEN=$(curl -sS -X POST http://127.0.0.1:5080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin-empty@gones.test","password":"Gones-dev-pass-123!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
PSQL="docker compose exec -T postgres psql -U gones_migration -d gones -tAc"
etag() { python3 -c "import base64,struct;print('\"'+base64.b64encode(struct.pack('>q',$1)).decode()+'\"')"; }
```

- [ ] **Baseline.** `$PSQL "SELECT scope_kind, count(DISTINCT scope_id), count(*) FROM player_statistics GROUP BY 1 ORDER BY 1"` prints `global|1|75`, `league|8|167` and `season|11|188` — 430 rows over 20 scopes. Record `$PSQL "SELECT rebuilt_at FROM player_statistics_meta"`; every check below compares against that timestamp.
- [ ] **Pick a victim.** `$PSQL "SELECT document_id, season_id, version FROM archive_tournaments WHERE deleted_at IS NULL AND season_id IS NOT NULL AND status='completed' ORDER BY tournament_date DESC LIMIT 1"` prints one row. Keep its three fields as `TID`, `SID` and `VER`; `$PSQL "SELECT count(*) FROM player_statistics WHERE scope_kind='season' AND scope_id='$SID'"` prints a non-zero count — record it.
- [ ] **A write updates the read model with no restart.** `curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH "http://127.0.0.1:5080/api/archive/tournaments/$TID" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "If-Match: $(etag $VER)" -d '{"name":"<the row'"'"'s current name>","tournamentDate":"<its current date>","status":"active"}'` prints `200`. Re-run both baseline queries at once: the total is now **below** 430, the Season scope count above has dropped, and `rebuilt_at` has moved forward. An `active` Tournament ranks nobody (ADR 0040), so its players leave every scope it fed.
- [ ] **And it is exact, not approximate.** Send the same `PATCH` again with `If-Match: $(etag $((VER+1)))` and `"status":"completed"`. It prints `200`, and the two baseline queries print **exactly** `global|1|75`, `league|8|167`, `season|11|188` again. A rebuild that dropped or duplicated rows would not land back on the same numbers.
- [ ] **One rebuild per write, and it is logged.** `docker compose logs api | grep 'Player statistics rebuilt'` ends with one `Player statistics rebuilt: N rows across 20 scopes in … ms.` line per write you just sent, on top of the startup one. `N` is 430 after the second write.
- [ ] **Deleting a Season drops the scopes its Tournaments left.** Pick a Season with results — `$PSQL "SELECT document_id, league_id, version FROM archive_league_seasons WHERE tournament_count > 0 ORDER BY tournament_count DESC LIMIT 1"` — then `curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "http://127.0.0.1:5080/api/archive/league-seasons/<id>" -H "Authorization: Bearer $TOKEN" -H "If-Match: $(etag <version>)"` prints `200`. Without a restart, `$PSQL "SELECT count(*) FROM player_statistics WHERE scope_kind='season' AND scope_id='<id>'"` prints `0`, the `league` count for its parent has dropped, and the `global` count has **not** — a Season delete detaches its Tournaments rather than deleting them, so they still rank globally as standalone. Re-run `npm run dev:env -- --env=demo` afterwards to put the archive back.
- [ ] **Re-parenting a Season re-keys the League scope.** With a fresh demo archive, take the same Season and `curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH "http://127.0.0.1:5080/api/archive/league-seasons/<id>/league" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "If-Match: $(etag <version>)" -d '{"leagueId":"<another live league id>"}'` — `$PSQL "SELECT count(*) FROM archive_leagues WHERE deleted_at IS NULL"` gives you the ids. It prints `200`, and without a restart the `league` scope row counts for the old and new parent have swapped that Season's players. Re-seed the demo archive afterwards.
- [ ] **The deliberate omissions do not rebuild.** Record `rebuilt_at`, then run these five writes: create a League (`POST /api/archive/leagues`), rename one (`PATCH /api/archive/leagues/<id>/name`), create a Season (`POST /api/archive/league-seasons`), rename one (`PATCH /api/archive/league-seasons/<id>/name`) and change one's status (`PATCH /api/archive/league-seasons/<id>/status`). All five answer `2xx`, and `rebuilt_at` is **unchanged**. None of them can move a single rating — a scope is keyed by document id and computed from its Tournaments' results — and a rebuild is a full recompute, so they deliberately do not pay for one. Creating a Tournament (`POST /api/archive/tournaments`) is in the same group: it mints an empty Tournament with no Round and therefore no Match.
- [ ] **A restore fills the read model on its own.** On a fresh `npm run dev:env -- --env=demo`, look at the seeder's own output: it still prints `Player statistics rebuilt: N rows, API ready again … ms after the restart.` That line comes from `scripts/seed-dev-environment.mjs`, which keeps its caller-side rebuild on purpose; this slice makes it redundant for the endpoint, not wrong. To see the endpoint do it alone, `POST /api/archive/restore` a small bundle with an `Idempotency-Key` header and confirm `player_statistics` grows before any restart.
- [ ] **The HTTP surface did not move.** `npm run api:check` exits `0` **without** anyone running `npm run api:generate`. No separate operation-ID check is needed: two endpoints sharing a `WithName` throw at startup, so a healthy `/health/ready` is itself the proof that all 101 are still unique.
- [ ] **Known, accepted — the cost.** A rebuild is a full recompute of every scope, inside the write's transaction and under one global advisory lock. Measured locally: 48 Tournaments → ~15–32 ms; a synthetic 25,048 Tournaments across 228 scopes → ~2.1–2.2 s of rebuild and ~5.6 s end-to-end for one `PATCH`. At the plan's stated scale that serialises archive writes to roughly one every six seconds. It is a known ceiling, not a defect of this slice; making the rebuild incremental is a separate, much larger change and the plan owner's call. Do not report it as a bug.
- [ ] **Known, accepted — T9's checklist line is now stale.** The T9 section says "The archive command endpoints carry no write-side rebuild, so the seeder triggers the startup one after the restore." That sentence describes the defect this slice fixes; the observable behaviour it asks for is unchanged, because the seeder's own rebuild stays. Do not report it.
- [ ] Confirm nothing else moved: `curl -sS -o /dev/null -w '%{http_code}\n'` against `http://127.0.0.1:5080/api/leagues-archive/all`, `.../api/archive/leagues/all`, `.../api/archive/league-seasons/all`, `'.../api/archive/tournaments/all?year=2026'`, `.../api/archive/years` and `.../api/archive/global-player-statistics` all print `200`. Then open `/events`, `/leagues-archive`, `/global-stats`, a player page and a Live tournament in the browser: everything renders as before, with no error toast and no red DevTools console error. This slice touches no file under `src/`, `cypress/`, `fixtures/` or `docs/`.

## T10 frontend-domain-and-local

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice is pure domain + browser-local persistence. **Nothing renders it and nothing in the running
application imports it yet** — that is the design, not an omission. So the manual pass has two jobs:
prove the legacy archive is untouched, and prove the new code is genuinely inert in the browser.

Start from a running stack on the demo data: `docker compose up -d --wait postgres migrator api worker`,
then `npm run dev:env -- --env=demo`, then `npm run dev:serve`. The dev server is `127.0.0.1:4200` and the
local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind fails, `pkill -f "ng serve"` and re-run.

- [ ] **The four gates are green on a clean checkout.** `npm run test` prints `Test Files 159 passed (159)` and `Tests 1793 passed (1793)` with no failed suite; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0` and prints `Output location: …/dist/gones`.
- [ ] **The new suites are the ones that grew.** `npx vitest run src/app/domain/archive-models.test.ts src/app/data/archive-origin.test.ts src/app/data/archive-summary.test.ts src/app/data/archive-command-ux.test.ts src/app/backend/local-archive-backend.service.test.ts src/app/backend/server-authority-boundary.test.ts` prints `Test Files 6 passed (6)` and `Tests 97 passed (97)`, `0 skipped`. A skipped test here means step 6.12 of the ticket was not finished.
- [ ] **The commit touched only this slice.** `git show --stat HEAD` lists exactly ten new files under `src/app/domain/`, `src/app/data/` and `src/app/backend/`, plus `M src/app/backend/server-authority-boundary.test.ts` and `M artifacts/manual_test_checklist.md`. In particular it must **not** list `src/app/domain/models.ts`, `src/app/backend/application-backend.ts`, `src/app/backend/local-league-archive-backend.service.ts` or any `src/app/data/league-archive-*.ts`.
- [ ] **The IndexedDB allowlist only grew.** `git show HEAD -- src/app/backend/server-authority-boundary.test.ts` shows two `+` lines and zero `-` lines. Deleting a path from that array is a later ticket's job; if this diff removed one, reject it.
- [ ] **The legacy archive still works end to end.** Open `http://127.0.0.1:4200/leagues-archive` signed out. The list renders with the demo Leagues and no error toast. Open one League: its tournaments, rounds and standings render. Create a browser-local League from that page, add a tournament to it, add a round, paste a result import into the round, and rename a player — every step saves and the page re-renders with no red DevTools console error.
- [ ] **No browser gains a new database.** With `/leagues-archive` open, DevTools → Application → Storage → IndexedDB lists `gones-leagues` and `gones-live` and **does not** list `gones-archive-local`. Nothing imports the new adapter yet, so no page can create it. Reload and re-check. If `gones-archive-local` appears, something wired the adapter in ahead of its ticket.
- [ ] **Every other page is unaffected.** Visit `/`, `/events`, an event detail page, `/global-stats`, a player page and a Live tournament. Each renders as before with no error toast and no red console error. This slice adds no route, no component, no DI token and no i18n key, so any visible change is a regression.
- [ ] **The lock rule agrees with the backend, day for day.** The browser rule and the C# `ArchiveLockRule` must not drift: `npx vitest run src/app/domain/archive-models.test.ts -t "365"` and `-t "366"` both pass, and `backend/src/Gones.Domain/Archive/ArchiveLockRule.cs` still reads `LockWindowDays = 365` with a strict `>`. 365 days old is **not** locked; 366 days old **is**. If either side changes that boundary alone, a Tournament locks on a different calendar day in the browser than on the server.
- [ ] **Known, accepted — a browser-local record is never locked.** `isArchiveTournamentRowLocked` returns `false` for any `local-` id whatever its date, so a browser-local Tournament dated 2000 stays editable. That is ADR 0028 (the browser store has no server lock to honour), not a missed guard. Do not report it.
- [ ] **Known, accepted — `locked` is absent from a Tournament row on purpose.** `ArchiveTournamentSummary` carries no `locked` field, while `ArchiveYearEntry` does. A Tournament row cached today as unlocked would become locked later with no refetch, so the client derives it from `tournamentDate`; a year entry is cheap to refetch and carries the flag. Both halves match `src/app/api/generated/gones-api.ts`. Do not report the asymmetry as a bug.
- [ ] **Known, accepted — `LOCAL_LEAGUE_STORE` now exists twice.** `local-league-archive-backend.service.ts` exports it for `gones-leagues` and `local-archive-backend.service.ts` exports it for `gones-archive-local`. Two modules, two bindings, no global collision; the legacy one is retired in a later ticket. Do not report it as a duplicate.

## T11 export-v5

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice is the **serialization boundary** and nothing else: a pure schema module, a pure
parse/validate service, a golden fixture set and one bilingual message key. **No component, no route,
no HTTP call, no persistence, and nothing in the running application imports it yet** — that is the
design, not an omission. So the manual pass has three jobs: prove the new contract is real and
reproducible, prove T9's committed archive corpus survived intact, and prove the running app is
byte-identical in behaviour.

Start from a running stack on the demo data: `docker compose up -d --wait postgres migrator api worker`,
then `npm run dev:env -- --env=demo`, then `npm run dev:serve`. The dev server is `127.0.0.1:4200` and the
local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind fails, `pkill -f "ng serve"` and re-run.

- [ ] **The four gates are green on a clean checkout.** `npm run test` prints `Test Files 161 passed (161)` and `Tests 1834 passed (1834)` with no failed suite; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0` and prints `Output location: …/dist/gones`. The count grew by exactly 41 over T10's 1793 — 31 schema tests plus 10 import-gate tests, and nothing else.
- [ ] **The new suites are the ones that grew.** `npx vitest run src/app/domain/archive-export-schemas.test.ts src/app/data/archive-import.service.test.ts` prints `Test Files 2 passed (2)` and `Tests 41 passed (41)`, `0 skipped`.
- [ ] **The golden fixtures live in their own directory and match their manifest.** `ls fixtures/archive-export/v5` lists exactly `bundle.json`, `legacy-v1.json`, `legacy-v4.json`, `manifest.json`. `node -e "const b=require('./fixtures/archive-export/v5/bundle.json'); console.log(b.version, b.leagues.length, b.leagueSeasons.length, b.tournaments.length, b.calendarEvents.length, b.tournaments.filter(t=>t.seasonId===null).length)"` prints `5 2 3 4 1 1`. `node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');console.log(createHash('sha256').update(readFileSync('fixtures/archive-export/v5/bundle.json','utf8')).digest('hex'))"` prints the same hex as `bundleSha256` in `fixtures/archive-export/v5/manifest.json`.
- [ ] **The generator is reproducible.** `sha256sum fixtures/archive-export/v5/*.json > /tmp/t11.sha && UPDATE_ARCHIVE_FIXTURES=1 npx vitest run src/app/domain/archive-export-schemas.test.ts && sha256sum -c /tmp/t11.sha` reports `OK` on all four files. Regenerating must never move a byte.
- [ ] **T9's archive corpus is untouched and still gated.** `git diff --quiet HEAD~1 -- fixtures/archive-domain ops/archive-domain-fixtures.test.ts fixtures/dev-environments/README.md` exits `0`, and `npx vitest run ops/archive-domain-fixtures.test.ts` prints `Tests 8 passed (8)`. `fixtures/archive-domain/v5/bundle.json` is still 310873 bytes with `"fixtureSet": "gones-archive-domain-v5"` in its manifest. These are two different corpora that both carry version 5; if this commit changed either file under `fixtures/archive-domain/`, reject it.
- [ ] **The commit touched only this slice.** `git show --stat HEAD` lists exactly four new files under `src/app/domain/` and `src/app/data/`, four new files under `fixtures/archive-export/v5/`, `M src/app/i18n/messages.ts` and `M artifacts/manual_test_checklist.md`. In particular it must **not** list `src/app/domain/models.ts`, `src/app/domain/export-schemas.ts`, `src/app/data/league-archive-import.service.ts`, anything under `fixtures/league-domain/`, `fixtures/archive-domain/`, `backend/`, `cypress/` or `docs/`.
- [ ] **`messages.ts` gained two lines and lost none.** `git show --stat HEAD -- src/app/i18n/messages.ts` shows `2 ++` and no `-`. `grep -n "msg.importLegacyBundleUnsupported" src/app/i18n/messages.ts` prints exactly two hits, one in the English block and one in the French block, each immediately after its `msg.importUnsupported` neighbour.
- [ ] **The refusal message reads correctly in both languages.** In the browser, switch the language to French and back. The two strings are in the catalogue but nothing displays them yet, so read them from the source: the English one names "version 5" and says there is no converter; the French one says the same and uses proper typographic apostrophes (`’`, not `'`).
- [ ] **Every page is unaffected.** Visit `/`, `/events`, an event detail page, `/leagues-archive`, a League inside it, `/global-stats`, a player page and a Live tournament. Each renders as before with no error toast and no red DevTools console error. This slice adds no route, no component, no DI token and no `data-cy`, so any visible change is a regression.
- [ ] **No browser gains a new database and no new bundle ships.** With the app open, DevTools → Application → Storage → IndexedDB lists the same stores as before T11. Nothing imports the new modules, so they are tree-shaken out of the production build; `grep -rl "archiveBundleFilename" dist/gones` finds nothing after `npm run build`.
- [ ] **Known, accepted — the legacy import door is still open in the running app.** The header's import control still calls `LeagueArchiveImportService`, so a v1–v4 Gones Export **still imports successfully** in the browser. This ticket only builds the new gate; wiring it (and the `importErrorMessage` classifier at `src/app/app.component.ts`) is a later ticket. Do not report the old import still working as a bug.
- [ ] **Known, accepted — two different schemas both call themselves `version: 5`.** The export **file** this ticket defines is `{version, leagues, leagueSeasons, tournaments, calendarEvents}` with a closed schema. The restore **request body** that `scripts/dev-environments.mjs` posts to `/api/archive/restore-full` is `{kind:'fullArchive', version:5, leagues, leagueSeasons, tournaments}` — it carries `kind` and no `calendarEvents`. `parseArchiveBundle` refuses that body with `unsupportedArchiveBundle`, deliberately, and a test pins it. The two are reconciled by conversion, never by being interchangeable. Do not report the refusal as a bug.
- [ ] **Known, accepted — the v5 gate checks shape, not referential integrity.** `parseArchiveBundle` accepts two Leagues sharing one `id`, a `leagueSeasons` row whose `leagueId` matches no League in the bundle, and a `tournaments` row whose `seasonId` matches no Season. It also accepts a `tournamentDate` that is not `YYYY-MM-DD`, even though the published `ARCHIVE_EXPORT_JSON_SCHEMA` prints that `pattern`. Validation depth is bounded on purpose at this layer; whoever persists a bundle owns those rules. Do not report them here — they belong to the ticket that wires the writer.
- [ ] **Known, accepted — `docs/adr/0047-archive-rebuild-without-migration.md` §7 is now stale.** It names `fixtures/archive-domain/v5/` as the export/import golden corpus; after this ticket that corpus is `fixtures/archive-export/v5/`. An ADR is a dated record and is not rewritten to match later work; the doc refresh belongs to T19. Do not report it.

## T12 indexeddb-catalog-cache

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice is the **browser storage half** of the archive rebuild and nothing else: two backend
services, one repository, three test suites and two allowlist entries. **No component, no route, no
`data-cy`, no i18n key, and nothing in the running application imports the three new modules yet** —
that is the design, not an omission. T13 wires the shell. So the manual pass has four jobs: prove the
four gates are green, prove the new database is *not* created by any page, prove the legacy archive
still works untouched, and prove logout leaves no user-scoped archive data behind.

Start from a running stack on the demo data: `docker compose up -d --wait postgres migrator api worker`,
then `npm run dev:env -- --env=demo`, then `npm run dev:serve`. The dev server is `127.0.0.1:4200` and the
local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind fails, `pkill -f "ng serve"` and re-run.

- [ ] **The four gates are green on a clean checkout.** `npm run test` prints `Test Files 164 passed (164)` and `Tests 1898 passed (1898)` with no failed suite; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0` and prints `Output location: …/dist/gones`. The count grew by exactly 64 over T11's 1834 — 18 cache tests, 17 queue tests and 29 repository tests, and nothing else.
- [ ] **The three new suites are the ones that grew.** `npx vitest run src/app/backend/archive-cache.service.test.ts src/app/backend/archive-backfill-queue.test.ts src/app/data/archive-repository.service.test.ts` prints `Test Files 3 passed (3)` and `Tests 64 passed (64)`, `0 skipped`.
- [ ] **The two atomicity proofs really are in the run.** `npx vitest run src/app/backend/archive-backfill-queue.test.ts --reporter=verbose` names both `an aborted write leaves the previously stored partition unchanged` and `a rejected loader writes no record at all` as passing. These are the tests that make "a year is whole or absent" true; a run that skips them proves nothing.
- [ ] **No page load creates the new database.** Open the app at `127.0.0.1:4200`, visit `/`, `/events`, `/leagues-archive`, a League inside it, `/global-stats` and a player page. Then in the DevTools console run `indexedDB.databases().then(console.log)`. The list must **not** contain `gones-archive-cache`. Nothing routes to the cache until T13, so if that database appears, something imported the new services early and the fence was breached.
- [ ] **No page writes an archive key to `localStorage`.** Still in the console: `Object.keys(localStorage).filter(k => k.startsWith('gones.archive'))` returns `[]`. The legacy key `gones.leagues-archive.catalog.v2` **may** still be present and is expected — the legacy page still owns it until T17 retires it. Only a `gones.archive.*` key is a failure.
- [ ] **The legacy archive is byte-identically unaffected.** `/leagues-archive` lists the same Leagues as before, a League detail page opens, a Tournament inside it opens, and the "Synchronize" control still refreshes the list. This slice changes no legacy file, so any visible difference is a regression.
- [ ] **Logout leaves no user-scoped archive data behind.** Log in as a demo account, visit a page that reads private data so the per-user cache is populated, then confirm in DevTools → Application → IndexedDB that `gones-server-read-cache` exists. Log out. Re-check: `gones-server-read-cache` is **gone**. This is the privacy-critical step — a per-user cache that survives logout would show the next account the previous account's rows.
- [ ] **Known, accepted — the public catalog cache deliberately survives logout.** Once T13 wires it, `gones-archive-cache` will persist across logout and that is correct, not a leak: every row in it is a copy of an anonymous public `GET /api/archive/**` answer, identical for every visitor and for no one in particular. Only `ServerReadCacheService` registers with `SessionScopeService`, so only it is purged. The browser-authored `gones-archive-local` also survives logout, by ADR 0028 — those are the user's own records and deleting them on logout would destroy authored data. Do not report either as a bug.
- [ ] **Known, accepted — the boundary allowlist grew by two, on purpose.** `src/app/backend/server-authority-boundary.test.ts` now names seven files under `confines IndexedDB to the sanctioned local adapters` and five under `keeps the public catalog cache helper to its declared importers`. Both additions are deliberate and carry their reason inline. `archive-backfill-queue.ts` also gained an explicit `const database: IDBDatabase` annotation so that detector can actually see it — without it a writer of a browser store would have been invisible to the assertion.
- [ ] **Known, accepted — `AGENT.md`'s storage-split sentence is now imprecise.** It states "public data caches in `localStorage` through `catalog-cache.ts`; private data caches in the per-user IndexedDB store". This ticket puts **public** data in IndexedDB, because a single year partition may hold 25,000 rows and will not fit the ~5 MB key-value budget. The split by *sensitivity* is unchanged and still holds; only the sentence's implied mapping of public→`localStorage` is now too narrow. The doc refresh belongs to T19. Do not report it.
- [ ] **Known, accepted — the ticket's own counts were stale and the tree won.** T12's `Validation` predicted the IndexedDB allowlist would name six files; it names seven, because T10 added `local-archive-backend.service.ts` after the ticket was written. Its `From Depends (T10)` table also named three `LocalArchiveBackend` methods that do not exist under those names. Both were reconciled against the code, not the text. Do not report the ticket/tree mismatch as an implementation defect.

## T13 archive-shell-league-seasons

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice is the **first user-visible page** of the archive rebuild: the shell (title, sync bar, two-tab
strip) and **Tab 1 — League Seasons**, a Variant B two-line table that is sortable, searchable,
League-filterable and paginated entirely in the browser over the two whole catalogs T12 caches. It is
**read-only** — no create, rename, delete or any other mutation — and it is **added beside** the legacy
`/leagues-archive`, which keeps working untouched until T19 retires it. The Tournaments tab is a
deliberate temporary redirect, not a missing page.

Start from a running stack on the demo data: `docker compose up -d --wait postgres migrator api worker`,
then `npm run dev:env -- --env=demo`, then `npm run dev:serve`. The dev server is `127.0.0.1:4200` and the
local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind fails, `pkill -f "ng serve"` and re-run.

- [ ] **The four gates are green.** `npm run test` prints `Test Files 171 passed (171)` and `Tests 2179 passed (2179)` with no failed suite — T13's own run reported 166 / 2020, T14 added the four archive suites on top for 2106, T15 added 57 rankings-scope tests on top of that, and T16 added 16 more; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0`. T13's slice grew the count by exactly 122 over T12's 1898 — 8 shell tests and 114 list tests.
- [ ] **`/archive` redirects and the shell renders.** Open `127.0.0.1:4200/archive`. The URL becomes `/archive/league-seasons`, the page title is `Archive`, the breadcrumb reads `Menu › Archive` (two crumbs, the second not a link), and the tab strip shows `League Seasons` and `Tournaments` with League Seasons visibly selected. A back button is present both above and below the content.
- [ ] **The rows are two-line, four-column.** On the demo data 12 Seasons render. Each row shows a `▸` expander then the Season name as a link, over its League name (the expander is T14's addition); the last-played date over an `upd. …` line; a `… tourn.` count over a `… players` count; and a status chip. Four `<th>` only — if you count more columns, the wrong variant shipped.
- [ ] **The lock marker is derived, not stored.** The `1996-97` Season (last played `1997-07-12`) shows 🔒; a Season last played inside the past year does not. The `2027` Season has no Tournament, shows `—` for last played, and is **never** locked. `locked` is computed on render from the date — it is deliberately not on the wire, so a row cached yesterday still locks correctly today.
- [ ] **Every header sorts, and exactly one is marked.** Click each of the four headers. The URL gains `?sort=…` / `?dir=…`, an arrow appears on that header, and `aria-sort` is present on **exactly one** `<th>` (inspect the elements). Clicking the already-active header flips the direction rather than re-selecting it. Note that `lastPlayed` + `desc` are the defaults and are deliberately **omitted** from the URL — landing back on a bare `/archive/league-seasons` after clicking the dates header is correct, not a lost sort.
- [ ] **Keyboard sorting works.** Tab to a column header until the header button has focus, press Enter, and confirm the sort changes. The headers are real `<button>`s, so this must work without a mouse.
- [ ] **The URL is the only state.** Produce a sorted, filtered, paged view, copy the URL, open it in a new tab. The view is reproduced exactly. Reloading likewise. No control may change the table without changing the URL.
- [ ] **Search is debounced and has its own empty state.** Type `vintage`. After ~300 ms the URL carries `?search=vintage` and the table shows `No Season matches “vintage”` — a *different* message from the empty-archive one. Clear it; all 12 rows return and the URL empties.
- [ ] **A stale League filter degrades to the whole list.** Pick a League from the filter and confirm `?league=<id>` appears and the list narrows. Now hand-edit the URL to `?league=ghost`. The **full** list must return — not an empty table. An unknown id silently falling back is the designed behaviour; a permanently empty table whose cause is invisible is the bug it prevents.
- [ ] **Bad query-string values fall back rather than erroring.** Load `?sort=rating&dir=sideways&size=30&page=0`. The page renders normally at `lastPlayed` / `desc` / 25 rows / page 1. No error banner, no blank screen.
- [ ] **Paging clamps without looping.** With 12 Seasons load `?page=9`. The page shows page 1 of 1 with all rows, and the URL is **not** rewritten. A clamp that navigated would loop forever.
- [ ] **The skeleton renders inside the real table.** In DevTools → Application → IndexedDB delete `gones-archive-cache`, then reload `/archive/league-seasons` with the network throttled. Five skeleton rows appear **inside** the table, under the four real headers, so the layout does not jump when the real rows replace them. (With a warm cache there is no visible skeleton — that is correct, the read is instant.)
- [ ] **Sorting, filtering and paging cost zero requests.** Open the Network tab. The first load issues exactly two archive catalog reads (`/api/archive/leagues/all` and `/api/archive/league-seasons/all`). Then sort, search, filter, change the page size and page — **no further archive request** may appear. Only the Synchronize button re-reads.
- [ ] **The page does not scroll sideways on a phone.** At 375 px width the **page** must not scroll horizontally. The table itself may scroll inside its bordered wrapper — that is the frozen Variant B design (`.table-wrap` is `overflow-x: auto`), not a defect. Known and accepted: the table measures ~394 px against ~352 px of wrapper, a ~42 px internal swipe, down from 678 px before the header/cell wrapping fix. Do not report the internal scroll as a bug.
- [ ] **French is complete.** Switch the language to French in Settings. Every visible string on the page is French: tabs `Saisons de ligue` / `Tournois`, toolbar `Rechercher` / `Ligue` / `Tri` / `Lignes`, headers `Saison / Ligue` and `Dernier tournoi / Mise à jour`, the second date line prefixed `maj`, and the page status ending in `saisons`. The breadcrumb still reads `Menu › Archive` — `Archive` is deliberately the same word in both languages.
- [ ] **The Tournaments tab is a real page now.** Click `Tournaments`. T13's temporary redirect back to `/archive/league-seasons` is gone: T14 replaced it with the real tab, so the URL becomes `/archive/tournaments?year=<newest>`. See the T14 section below.
- [ ] **A Season link opens its page now.** Click a Season name. T13 left `/archive/league-seasons/<id>` unregistered and the Not Found page was correct then; T14 added the route, so the Season page must render. See the T14 section below.
- [ ] **The legacy archive is untouched.** `/leagues-archive` still renders the legacy card grid with its own breadcrumb `Menu › Leagues Archive`, a League detail page opens, a Tournament inside it opens, and `/leagues` still redirects to it. This slice changes no legacy file, so any visible difference is a regression.
- [ ] **The console is clean.** With DevTools open, walk the whole page — load, sort, search, filter, page, switch language, Synchronize. Zero console errors.
- [ ] **Known, accepted — browser-local Seasons appear in this table.** T12's `listLeagueSeasons()` merges the browser-authored half into the catalog it returns, so a Season you created in the browser shows up here alongside the server's. T13's own ticket text assumed it would not (it predates T12) and T18 is the ticket that formally wires the union into both tabs. A browser-local Season is also **never** locked whatever its date, because its author must always be able to edit it. Do not report either as a bug.
- [ ] **Fixed by T16 — the Synchronize button on this page now makes a real request.** T13 measured it at **0** network requests: the archive catalog endpoints send `Cache-Control: public, max-age=3600`, so a forced refetch inside that hour was answered from the browser's own HTTP cache and never reached the network tab — which also swallowed the refetch that follows a cache invalidation. T16 marks every `/api/archive/**` GET `Cache-Control: no-cache`, so the request reaches the server (as a conditional revalidation the server answers `304` when nothing changed). Pressing Synchronize here must now show **2** archive requests in the Network tab, every time, with no hard reload and no "Disable cache". The legacy `/leagues-archive` Synchronize is deliberately **not** fixed and still makes 0 — see the T16 section.

## T14 tournaments-tab-expansion

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice adds **Tab 2 — Tournaments** to the archive shell T13 built, plus the four pages the rows
link to: the Season page, the Tournament page and its two result views. It also makes a Tab 1 Season
row **expand one level** into its Tournaments. Everything here is **read-only** — no create, rename,
delete or status toggle — and nothing legacy is touched: `/leagues-archive/**` keeps working until T19.

The point of the slice is the **standalone Tournament** (`seasonId: null`): one that belongs to no
Season and therefore to no League. It must appear in Tab 2 like any other row, with an **empty**
League line — not "Unassigned", not a dash.

Start from a running stack on the demo data: `npm run dev -- --env=demo --detached`, then
`npm run dev -- --no-docker`. The dev server is `127.0.0.1:4200` and the local API is `127.0.0.1:5080`.
If the `127.0.0.1:4200` bind fails, `pkill -f "ng serve"` and re-run. The demo data holds 8 archive
Leagues, 12 Seasons and 48 Tournaments across the years 1996, 1997, 2024, 2025 and 2026, and **four**
of the 2026 Tournaments are standalone.

- [ ] **The four gates are green.** `npm run test` prints `Test Files 170 passed (170)` and `Tests 2163 passed (2163)` — T14's own run reported 2106, and T15 added 57 rankings-scope tests on top; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0`. `npm run e2e:ci` prints `=== e2e specs: 27/27 passed ===` — no Cypress spec was edited by this slice (T15 later rewrote `global-stats.cy.js`, which adds no spec file and leaves the 27 unchanged).
- [ ] **Tab 2 opens on the newest year and writes it into the URL.** Open `127.0.0.1:4200/archive/tournaments`. The URL becomes `?year=2026` with **no** extra history entry — press Back once and you land wherever you were before, not on the yearless URL. The table shows four `<th>` carrying six values: `Tournament / League`, `Date / Updated`, `Players`, `Status`.
- [ ] **A standalone Tournament has an empty League line and full row height.** Search for `FNM` (a 2026 standalone). Its second line under the name is **blank** — inspect it: the `<span class="archive-sub">` element is present in the DOM and holds no text. Compare its row height against a season-bound row such as `Etapa 3`: identical. A standalone row one line shorter than its neighbours is the bug this checks for.
- [ ] **The year select offers exactly the indexed years, newest first, and no "all years".** The select lists `2026, 2025, 2024, 1997, 1996` in that order. There is no "All" option — a union of whichever years this browser happens to hold would render a list whose completeness depends on cache history.
- [ ] **Paired headers sort on their first value; the select reaches all six.** Click `Tournament / League`: the URL gains `?sort=name`, an arrow appears, and `aria-sort` is on exactly one `<th>`. Clicking it again flips the direction. Now use the sort select to reach `League name`, `Last updated` and `Status` — three keys no header exposes. The `↑`/`↓` button beside the select flips direction without changing the key.
- [ ] **A standalone row sorts last in both directions by League name.** Sort by `League name` ascending, then descending. The rows with a blank League line stay at the **bottom** both times. An absent value is not a small value.
- [ ] **The URL is the only state.** Produce a sorted, searched, paged view on a chosen year, copy the URL, open it in a new tab: reproduced exactly. Defaults are omitted from the URL — except `year`, which is always written.
- [ ] **Bad query-string values fall back rather than erroring.** Load `/archive/tournaments?year=20x4&sort=rating&dir=sideways&size=30&page=0`. The page renders on the newest year at `date` / `desc` / 25 rows / page 1, with no error banner. Then load `?year=1999` — an unknown year silently resolves to 2026 rather than showing an empty table.
- [ ] **Search filters both names.** Type `lyon`: rows match on the League line as well as the Tournament name. Clear it and all rows return. The search is debounced ~300 ms, the same as Tab 1.
- [ ] **The lock marker is derived, not stored.** Switch the year to `1996`. Every row shows 🔒. Switch to `2026`: no row does. `locked` is never on the wire for a Tournament row — it is computed at render from `tournamentDate`, so a row cached yesterday still locks correctly today.
- [ ] **A Season row expands one level, inline.** Go to `/archive/league-seasons` and click a row's `▸`. The row expands into compact one-line children — Tournament name · date · players · status — **not** a nested table. Clicking a second Season's chevron collapses the first: only one Season is ever open.
- [ ] **The expansion is keyboard reachable and correctly announced.** Tab to the `▸` button and press Enter: it expands. Tab again: focus lands on each child line in turn, because they are real links. Inspect the button: `aria-expanded` flips `false`→`true` and `aria-controls` names the id the children `<tr>` actually carries. The `<tr>` itself deliberately carries **no** `aria-expanded` — on a plain table row that attribute is an axe `aria-conditional-attr` violation and no screen reader acts on it.
- [ ] **Clicking a name navigates; clicking the row expands.** Click the Season name link: you land on the Season page. Go back, click anywhere else on the row: it expands instead. The two must not fight.
- [ ] **The expansion never writes the Tournament cache.** This is the invariant the slice exists to protect. Open DevTools → Application → IndexedDB → `gones-archive-cache` → `year-partitions`. First visit `/archive/tournaments` so the store is populated, then go to `/archive/league-seasons` and expand a Season whose years are not all locked. Compare the store **before and after**: byte-identical, same record count, same `completedAt` stamps. Only the backfill queue may ever write a year partition.
- [ ] **A fully cached, complete and locked Season expands with no request.** Open the Network tab, expand a Season whose Tournaments are all in 1996/1997 (both locked years) after having loaded those years on Tab 2. No `/api/archive/league-seasons/…/tournaments` request appears. Expanding a 2026 Season does issue one — that year is not locked, so the server answers.
- [ ] **The Season page renders the Season, its League, its counters and its whole Tournament list.** Click a Season name. The page shows the name, the League beneath it, a status chip, `N Tournaments · M players`, the date range, and every Tournament as a clickable line. Back buttons are present above **and** below. When the list came from the server it says so: *"Read from the server. This list is not stored in this browser."*
- [ ] **A Tournament page is read-only and states its Season, or that it has none.** Open a season-bound Tournament: it links its Season. Open a standalone one (`FNM`): it shows *"Standalone Tournament — no League"* and **no** Season link. Both show the date, the `Updated …` stamp, the status chip, the computed ranking, the rounds as plain text, a link to the result, and *"This page is read-only."* There is no input, no save button and no delete anywhere on the page.
- [ ] **The result page keeps both views and both downloads.** From a Tournament, click *See the Result*: standings render with the player/round/match badges. Click *See archetype share*: the metagame bars render. Both `Download image` and `Download all` are present and produce a file. The title of a standalone Tournament's result names **no** League — never "Unknown league".
- [ ] **Breadcrumbs never say Not Found under `/archive/**`.** Walk `/archive`, `/archive/league-seasons`, a Season page, `/archive/tournaments`, a Tournament page, its result and its metagames view. Each shows a real trail (`Menu › Archive › Tournaments › Tournament › Result`), and the middle crumbs are links that work.
- [ ] **French is complete on all five pages.** Switch the language to French in Settings. Tab 2 shows `Rechercher`, `Année`, `Tri`, `Lignes`, headers `Tournoi / Ligue` and `Date / Mise à jour`, and a page status ending in `tournois`. The Season page, the Tournament page and both result views are French throughout. Nothing stays English, and the page must not scroll sideways at 375 px width — the table may scroll inside its own bordered wrapper, which is the frozen Variant B design.
- [ ] **The legacy archive is untouched.** `/leagues-archive` still renders the legacy card grid, a League detail page opens, a Tournament inside it opens, its result opens, and `/leagues` still redirects. This slice changed no legacy file.
- [ ] **The console is clean.** With DevTools open, walk both tabs, an expansion, all four new pages, a language switch and the Synchronize button. Zero console errors.
- [ ] **Known, accepted — opening Tab 2 warms every year, not only the displayed one.** T12's `listTournaments()` backfills every due year through the single backfill queue before it returns, and this tab filters that result to the chosen year. The year partition is the *fetch unit* — bounded requests, per-year ETags, the 25,000-row cap — not a promise that only one year is ever cached. On a large archive the first paint therefore waits on the whole backfill. That is T12's committed behaviour; do not report it as a Tab 2 defect.
- [ ] **Known, accepted — a browser-local Tournament reaches Tab 2 but its detail page says Not Found.** T12's catalog read merges the browser-authored half, so a Tournament you created locally appears in the table; the detail route reads the server, which has never heard of it. **T18** is the ticket that wires the browser-local union through both tabs and the detail pages. Do not report it as a Tab 2 defect.
- [ ] **Known, accepted — the shared ranking table raises two axe violations.** `aria-required-children` and `aria-required-parent` fire on `.mat-mdc-table` and its `<th role="columnheader">` cells on the Tournament page. They come from Angular Material's `mat-table` role mapping inside the shared `gones-ranking-table`, and the **legacy** `/leagues-archive/:id/tournaments-archive/:id` page raises the identical two rules over the identical node set. Pre-existing, affects both surfaces, not introduced here — a real defect worth its own ticket, but not this one's.
- [ ] **Known, accepted — the tab strip is the shell's, not Tab 2's own.** T14's ticket text predates T13 shipping `gones-archive-shell` and assumed the tab strip had to be rendered locally. It is not: Tab 2 joins the shell, which is why it also gets the ADR 0039 sync bar. Two tab strips on one surface would have been the bug.

## T15 rankings-scope-filter

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice puts a **scope filter** on Global Rankings. Two single-select fields — League and Season —
plus a badge that names the scope on screen. The point of the slice is that a scoped rating is
**read from the `player_statistics` table, never replayed in the browser**: every selectable scope
already has a stored Glicko-2 rating, which is why the filter is single-select and why an empty scope
is a legitimate empty state rather than a cue to recompute anything.

Two consequences to keep in mind while testing. First, the page now **pages, sorts and searches on the
server**: `/global-stats` moved from the one-shot `/api/leagues-archive/global-player-statistics/all`
catalog to the paged `/api/archive/global-player-statistics`, so every control is a round trip and the
truncation warning is gone with the catalog cap that produced it. Second, the sort-direction parameter
in the **browser URL** is now `dir`, not `direction`; `direction` is still the name on the wire.
Gones has no users, so there is no alias and no redirect — a stale `?direction=desc` link simply falls
back to the default order.

Start from a running stack on the demo data: `npm run dev -- --env=demo --detached`, then
`npm run dev -- --no-docker`. The dev server is `127.0.0.1:4200` and the local API is `127.0.0.1:5080`.
If the `127.0.0.1:4200` bind fails, `pkill -f "ng serve"` and re-run. After a demo seed
`player_statistics` holds **430 rows across 20 scopes** — 75 global, 167 league over 8 Leagues, 188
season over 11 Seasons.

- [ ] **The four gates are green.** `npm run test` prints `Test Files 170 passed (170)` and `Tests 2163 passed (2163)` with no failed suite — 57 more than T14's 2106, all of them in the two `global-stats` suites; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0`. `npx cypress run --spec cypress/e2e/global-stats.cy.js` prints `All specs passed!` with `28` passing.
- [ ] **The scope bar renders and defaults to the global scope.** Open `127.0.0.1:4200/global-stats`. Above the search row sits a bordered bar holding `League`, `Season` and a badge reading `◆ Rating scope: All tournaments`. Both selects read *All leagues* / *All seasons*. The URL carries **no** `league` or `season` key — a default is never written. There is no scope note under the table and no kicker above the page title.
- [ ] **Nothing about the unscoped page changed.** The status line reads `Page 1 of 1 (75 players)` — the plain copy, with no "in this scope" — the top row is `#1`, and the eleven column headers are the ones that were always there. This is the regression that matters most: adding the filter must not change what `/global-stats` shows when no scope is chosen.
- [ ] **Choosing a League scopes the request and narrows the Season select.** Open the Season select first and count the options: 12 Seasons plus *All seasons*. Close it, pick a League (for example `Liga Sword`), and the URL gains `?league=<id>`. Open the Season select again: it now offers only that League's Seasons plus *All seasons*. The badge reads `◆ Rating scope: Liga Sword`.
- [ ] **The numbers are the scope's own record, not the global ones filtered down.** With `Liga Sword` chosen, find `Demo Archive Player 15`. In the global scope that player shows rating `1663`, `30` matches and `10` tournaments; inside `Liga Sword` the same player shows rating `1716`, `6` matches and `2` tournaments. A **different rating as well as different counters** is the proof the row was recomputed inside the scope. Under the table a note says so in words.
- [ ] **The rating comes out of the table, not from a replay in the browser.** This is the headline invariant. With the League scope open, run `docker compose exec -T postgres psql -U gones_migration -d gones -c "update player_statistics set rating = 4242 where scope_kind='league' and scope_id='<the League id>' and player_name='Demo Archive Player 15';"`, then reload `/global-stats?league=<id>&sort=rating&dir=desc`. The player renders `4242` at position `#1`. `4242` is a value no Glicko-2 replay of those 6 matches could produce, so a browser that computed anything would print `1716` instead. **Restore the row afterwards** with the same statement and the original value `1715.8390278431052`, and confirm the page is back to `1716`.
- [ ] **Choosing a Season pins its League, and the Season wins over the League.** With *All leagues* still selected, pick a Season directly. The League select jumps to that Season's owning League and the URL carries **both** `?league=<id>&season=<id>`. The badge names the **Season**, not the League — a Season is the narrower scope, so it is the one the server is asked for. The two selects and the badge can never disagree.
- [ ] **Choosing a League that does not own the current Season clears the Season.** With a Season chosen, switch the League select to a different League. The Season select falls back to *All seasons* and `season=` disappears from the URL, leaving `?league=<the new id>`. Choosing a League that *does* own the Season keeps it.
- [ ] **Positions renumber 1..n inside every scope.** In the global scope the top row is `#1`. Switch to a League: still `#1`. Switch to one of its Seasons: still `#1`. The server assigns `position` per scope and per page and the client renders that number without arithmetic of its own — a scope showing `#14` at the top is the bug this checks for.
- [ ] **The status line counts players in this scope.** Unscoped it reads `Page 1 of 1 (75 players)`. Scoped to a League it reads `Page 1 of 1 (24 players in this scope)`; scoped to one of its Seasons, `Page 1 of 1 (15 players in this scope)`.
- [ ] **An empty scope explains itself instead of looking broken.** Load `/global-stats?season=00000000-0000-0000-0000-000000000000` — an id no Season has. The page answers `200` with an empty table reading *No player has a rating in this scope yet.* followed by *Standalone tournaments count towards the global ranking only.* There is **no** error banner: an unknown or deleted scope id is a legitimate empty state, not a failure. That second line is the answer to the real question — a player whose only results are standalone Tournaments (`seasonId: null`) appears under *All tournaments* and in no League or Season scope.
- [ ] **A real empty search still says *No players found.*** In any scope, search for `zzzz`. The copy is the generic *No players found.* and the standalone hint is **absent** — an empty search result is a different situation from an empty scope.
- [ ] **Sorting, paging and searching are server round trips inside the scope.** With a Season chosen, open the Network tab and click the `Rating` header. One request to `/api/archive/global-player-statistics` goes out carrying `scopeKind=season`, `scopeId=<id>`, `sort=rating` and `direction=desc`, and the browser URL gains `sort=rating&dir=desc` — note `dir` in the URL against `direction` on the wire. Type in the search box: one request after roughly 300 ms, not one per keystroke. Change the page size to 25: the request carries `pageSize=25`. Every one of these resets the page to 1 except paging itself, and every one keeps the scope.
- [ ] **The page size default is 100 and is never written to the URL.** The size select reads `100` on a fresh load and the URL has no `size` key. The offered sizes are `10`, `25`, `50`, `100`. (The archive tabs default to 25 — two surfaces, two deliberate defaults.)
- [ ] **The URL is the only state.** Produce a scoped, sorted, searched, paged view, copy the URL into a new tab: reproduced exactly, badge included. Then hand-type a bad scope: `/global-stats?league=%20&season=` falls back to the global scope rather than erroring.
- [ ] **A filter failure narrows the filter without hiding the ranking.** Block `/api/archive/leagues/all` and `/api/archive/league-seasons/all` in DevTools (Network → Block request URL) and reload. A `role="status"` notice reads *Could not load the League and Season filters.*, both selects still offer their *All* option, and **the ranking table still loads**. Unblock and reload to recover.
- [ ] **A rankings failure behaves differently with and without rows on screen.** Block `/api/archive/global-player-statistics` and load the page cold: a `role="alert"` banner reads *Could not load global statistics.* Now unblock, load normally, re-block, and press Synchronize: the previous page **stays on screen**, the sync bar flips to its offline state, and no error banner appears. A read-only public page shows the same message for a `400` as for a dropped connection, which is correct here.
- [ ] **The badge falls back to the raw id rather than going blank.** Load `/global-stats?league=<a real id>` and watch the badge on first paint: it may briefly show the raw id before the catalog lands, then resolve to the League name. It must never render `Rating scope:` with nothing after it.
- [ ] **French translates every new string, and nothing overflows.** Switch the language to French in Settings. The bar reads `Ligue` and `Saison`, the options `Toutes les ligues` / `Toutes les saisons`, the badge `◆ Portée du classement : Liga Sword`, the status `Page 1 sur 1 (24 joueurs dans cette portée)`, the note `Matchs, tournois et pourcentage de victoires sont le bilan de chaque joueur dans cette portée, et non ses chiffres globaux filtrés.` and the empty scope `Aucun joueur n'a encore de classement dans cette portée.` French is the width worst case: at 375 px the page must not scroll sideways — the scope bar wraps and the table scrolls inside its own wrapper.
- [ ] **The badge is announced in full.** Inspect the badge with the accessibility inspector: its accessible name is the whole sentence `Rating scope: Liga Sword`, and the `◆` is `aria-hidden`. The badge deliberately carries **no** `aria-label` — one would replace the visible text and announce only "Rating scope", swallowing the very name the badge exists to state.
- [ ] **Both back buttons and the sync bar are still there.** A back button sits above the title and another below the table (ADR 0044). The sync bar shows a "last synced" stamp that updates when you press Synchronize, and Synchronize refetches **the current scope** — check the request still carries `scopeKind` and `scopeId`.
- [ ] **The legacy surfaces are untouched.** `/leagues-archive` still renders, a League detail page opens and still shows its own rankings — it keeps using the old catalog cache and the old `/api/leagues-archive/**` endpoint, which this slice deliberately left in place. `/players/:name` and `/events` still load. The three legacy statistics endpoints stay pinned to the global scope; nothing routes them through the scoped one.
- [ ] **The console is clean.** With DevTools open, walk the global scope, a League scope, a Season scope, an empty scope, a sort, a page change, a search and a language switch. Zero console errors and zero warnings.
- [ ] **Known, accepted — a browser-local League or Season appears in the selects and reads as an empty scope.** `ArchiveRepository.listLeagues()` and `.listLeagueSeasons()` merge the browser-authored half, so a League you created locally is offered in the picker. The server has never heard of it, so the scoped read answers `200` with no rows and the page renders *No player has a rating in this scope yet.* That is the empty-scope path working as designed, not a defect — a browser-local record has no stored server-side rating to show. Filtering the local half out of the pickers belongs to the ticket that unions the browser-local archive through these surfaces, not here.
- [ ] **Known, accepted — this page no longer keeps a 24-hour catalog in `localStorage`.** It reads one page per request against `Cache-Control: public, max-age=60` instead, which is a deliberate decision of this slice: caching a 5,000-row catalog *per scope* would multiply the very storage this plan is moving out of `localStorage`, and the short max-age exists so an archive edit is not hidden behind a long-lived client copy. The `gones.global-stats.catalog` entry is left in place because the legacy League detail page still uses it. The sync bar and its "last synced" stamp stay.

## T16 cache-invalidation-resync

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice makes archive cache invalidation **provable** rather than merely working, gives the user a
manual escape hatch for the one staleness the caching design accepts, and fixes a defect that made
both of those pointless: every archive Synchronize was making **zero** network requests, because
`Cache-Control: public, max-age=3600` let the browser answer out of its own HTTP cache. That second,
invisible TTL also swallowed the refetch that follows an invalidation, so a mutation could have stayed
invisible for up to an hour — ADR 0039 says the TTL governs navigation, never correctness.

Two things this slice deliberately does **not** do. It adds no mutation to the archive: the
`/archive/**` surface is read-only today, and the coverage test exists to go red the day that changes.
And it does not touch the legacy `/leagues-archive` Synchronize, which has the same pre-existing defect
and dies with that surface at T19.

Start from a running stack on the demo data: `npm run dev:env -- --env=demo`, then `npm run dev:serve`.
The dev server is `127.0.0.1:4200` and the local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind
fails, `pkill -f "ng serve"` and re-run.

- [ ] **The four gates are green.** `npm run test` prints `Test Files 171 passed (171)` and `Tests 2179 passed (2179)` with no failed suite; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0`.
- [ ] **Synchronize now reaches the server — count the requests.** Open `/archive/league-seasons` with the Network tab filtered to `archive`. The first load shows exactly two reads (`/api/archive/leagues/all`, `/api/archive/league-seasons/all`). Press **Synchronize**: two more requests appear. Press it again straight away: two more again. Before T16 this count was **0** and stayed 0 for an hour. Do **not** use a hard reload or "Disable cache" — the whole point is that it works without them.
- [ ] **The requests are revalidations, not re-downloads.** Inspect one of those Synchronize requests. It carries the request header `Cache-Control: no-cache`, and when nothing has changed on the server the response is `304 Not Modified` with an `ETag`. A `200` with a full body is also correct (it means the data really did change or the browser had no validator) — what must never appear again is *no request at all*.
- [ ] **The Tournaments tab refetches too.** Switch to the Tournaments tab, let it settle, then press Synchronize. Requests appear for `/api/archive/years` and for each cached year partition (`/api/archive/tournaments/<year>`).
- [ ] **The legacy Synchronize is unchanged, on purpose.** Open `/leagues-archive`, watch the Network tab, press its Synchronize button. **Zero** requests is the expected result here. This is a pre-existing defect on a surface T19 deletes; it is deliberately out of this slice. Do not report it as a T16 regression.
- [ ] **The resynchronize section is collapsed on arrival.** Open `/settings` and scroll to **Resynchronize everything**. Only the header is visible: the help paragraph and the button are hidden until you click the header. It must be collapsed on every fresh arrival — if it is ever open when the page loads, that is the bug this check exists for.
- [ ] **It is available to everyone.** Open `/settings` **signed out**, and again as a plain User. The section is present both times. It repairs a public read cache, so it has no role, capability or Power-User gate.
- [ ] **The button clears the cache and refills it.** Expand the section. In DevTools → Application → IndexedDB, note that `gones-archive-cache` holds rows in `leagues`, `league-seasons`, `meta` and `year-partitions`. Press the button: the label switches to `Resynchronizing…` while it runs, requests appear in the Network tab, and the status line reads `Archive cache cleared. Fresh data is downloading.` Refresh the IndexedDB view — the stores are repopulated.
- [ ] **It clears before it refills.** Set the Network tab to **Offline**, then press the button. It reports `Could not resynchronize the Archive.`, the button re-enables itself, and `gones-archive-cache` is left **empty** — every store at 0 records. That empty cache is the proof the clear ran first; a refill that ran first would have left the old rows in place. Go back Online and press the button again to restore the cache.
- [ ] **It cannot be started twice.** Press the button and immediately try to press it again while `Resynchronizing…` is showing. It is disabled and nothing runs twice. When it finishes, the button is enabled again whether it succeeded or failed.
- [ ] **Nothing you authored is deleted.** Before resynchronizing, create a League in the browser from the legacy `/leagues-archive` page while signed out (a browser-local record). Resynchronize, then reload `/archive/league-seasons`. Your local row is still listed. The authored archive lives in `gones-archive-local`, a different database from the `gones-archive-cache` this button drops.
- [ ] **French is complete.** Switch the language to French in Settings. The section reads `Tout resynchroniser`, the help paragraph starts `Vide toutes les copies de l’archive…`, the button reads `Tout resynchroniser` (and `Resynchronisation…` while running), and the status reads `Cache de l’archive vidé. Les données fraîches sont en cours de téléchargement.` No raw key such as `settings.archiveResync` may appear anywhere on the page.
- [ ] **Logout leaves no user-scoped data behind.** Sign in as `user-two-registrations@gones.test` (`Gones-dev-pass-123!`), open `/registrations` so a private read is cached, then open DevTools → Application → IndexedDB and confirm **`gones-cache`** exists. Sign out. `gones-cache` must be **gone** from the database list. In the same view, `gones-archive-cache` must still be there **with its rows intact** — it holds only public, anonymous answers, so it is correct for it to survive — and `gones-archive-local` must survive too. A per-user database that outlives logout would show the next account on this browser the previous one's data; that is the failure this check exists to catch.
- [ ] **The legacy invalidation seam still fires.** Sign in as `admin-empty@gones.test`, open a legacy `/leagues-archive/:leagueId` page and rename the League. In DevTools → Application → Local Storage, the key `gones.leagues-archive.catalog.v2` is dropped by the rename, and the list page shows the new name without a manual refresh. The new `gones-archive-updated` announcement must **not** drop that key — the two seams are separate and both are alive until T19.
- [ ] **The console is clean.** With DevTools open, walk `/archive/league-seasons`, the Tournaments tab, Synchronize on both, `/settings`, expand and run the resynchronize once online and once offline, and switch language. Zero console errors.
- [ ] **Known, accepted — resynchronizing while offline leaves the archive empty until you are back online.** The clear runs first by design, so a refill that cannot reach the server leaves nothing behind and the archive pages show their empty/error state until the next successful load. The alternative — refill first — would let the backfill decide a year it was about to drop is still present, which is the staleness this button exists to fix. Nothing user-authored is affected.
- [ ] **Known, accepted — there is no archive mutation to watch invalidate yet.** `ArchiveRepository` is read-only, so no page on `/archive/**` can create, rename or delete anything, and the invalidation funnel currently has no production caller other than this button. The structural test `src/app/data/archive-cache-invalidation.test.ts` is what holds the guarantee: add a mutating method to that class without routing it through `invalidateArchiveCaches()` and `every mutating method reaches the invalidation funnel` names it and fails the build.

## T17 archive-staged-edit

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice puts ADR 0037's **power-user staged editor** on the new archive surface. It is the first and
only mutation on `/archive/**`: `/archive/tournaments/:tournamentId` still loads read-only for everyone,
an authorized Power User clicks **Edit**, mutates an in-memory draft that touches no store, and one
confirmed **Save Changes** sends a single explicit-intent batch to
`POST /api/archive/tournaments/{id}/edit-batch` with a mandatory `If-Match`. A `200` adopts the
authoritative document that comes back in the response body — there is **no** refetch afterwards.

Three refusals to keep straight while testing, because they are different things and must look
different on screen. **`412 stale_version`** means somebody else committed while you were drafting: the
draft survives, and **Reload Latest** appears. **`409 archive_tournament_locked`** means the Tournament
was played more than 365 days ago: the draft survives, and Reload Latest must **not** appear, because a
lock is not a version conflict. Neither one ever retries — a silent retry would overwrite the other
person's edit. The 365-day lock is derived from `tournamentDate` at render time, never stored, and a
browser-local (`local-`) record is exempt from it.

The legacy `/leagues-archive` and `/tournaments-archive` staged editors are untouched and stay live
until T19; both surfaces work at the same time.

Start from a running stack on the demo data: `npm run dev:env -- --env=demo`, then `npm run dev:serve`.
The dev server is `127.0.0.1:4200` and the local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind
fails, `pkill -f "ng serve"` and re-run. The API needs `GONES_FEATURES__AUTH_V1=true` for sign-in to
exist at all; `npm run dev:env` sets it, a bare `docker compose up` does not.

- [ ] **The four gates are green.** `npm run test` prints `Test Files 174 passed (174)` and `Tests 2242 passed (2242)` with no failed suite; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0`. `npx cypress run --spec cypress/e2e/archive-staged-edit.cy.js` prints `7 passing`.
- [ ] **The page is read-only for a visitor.** Signed out, open any row from `/archive/tournaments`. The paragraph *"This archived Tournament is read-only."* is visible, there is no **Edit** button, and there is no name, date or Season input anywhere on the page.
- [ ] **Power mode alone grants nothing.** Still signed out, turn **Power User** on in `/settings` and reopen the same server Tournament. There is still no Edit button — the browser preference is a UX capability, never an authority.
- [ ] **All three gates together reveal the control.** Sign in as `organizer-aura-live-standings@gones.test` (`Gones-dev-pass-123!`), keep Power User on, and open a Tournament dated inside the last 365 days. **Edit** and the status toggle (**Mark complete** / **Reopen**) are now visible.
- [ ] **Editing is a draft, not a write.** Click Edit. The name, date and Season fields appear. Change the name, add a round, add a match, type two player names. Open DevTools → Network filtered to `archive`: **no request has been made**. Now press F5. The page comes back with the original name and without the staged round — the draft lived only in memory.
- [ ] **One save is one request, and the response is adopted.** Edit again, change the name, press **Save Changes**. Exactly one dialog appears, and its message names the Season move and both deletion counts (`Deleted rounds: 0. Deleted entries: 0.`). Confirm. In the Network tab there is exactly **one** `POST …/edit-batch` carrying an `If-Match` header, and **no** `GET …/tournaments/{id}` after it. The heading shows the new name and the page is back to read-only.
- [ ] **The server row really changed.** In a terminal, `curl -sS http://127.0.0.1:5080/api/archive/tournaments/<id>`. The `name` is the new one and `documentVersion` went up by exactly **one** — not two, not zero.
- [ ] **An empty save writes nothing.** Click Edit, change nothing, press Save Changes. No dialog opens, no request is made, and the page simply leaves edit mode.
- [ ] **A deletion is summarised once, and marked destructive.** Edit, delete a round through its `⋯` menu and delete one entry from another round, then Save Changes. The single dialog reports both counts, and the confirm button is styled as destructive. Cancel it: no request is made and the draft is still there.
- [ ] **Cancel asks only when it has something to lose.** Click Edit and immediately **Cancel Edit** — it exits with no dialog. Click Edit, change the name, then Cancel Edit — a confirmation appears; cancelling it keeps you in edit mode with the change intact.
- [ ] **A blank name is refused before any request.** Edit, clear the name field entirely, press Save Changes. The message *"Give this Tournament a name before saving."* appears, no dialog opens, no request is made, and the rest of the draft is untouched.
- [ ] **`412` keeps the draft and offers Reload Latest.** Open the Tournament and click Edit. In a second terminal, commit a rename to the same Tournament through the API so its version moves on. Back in the browser, change the name and Save Changes. The message *"This Tournament changed since you opened it…"* appears, the name field still holds **your** text, and a **Reload latest saved data** button appears. The Network tab shows exactly one `POST` — nothing retried.
- [ ] **Reload Latest never merges.** Press it and cancel the confirmation: the draft is still there, still one `POST` in total. Press it again and confirm: the page shows the **other** person's name, the draft is gone, edit mode has exited, and still no second write was attempted.
- [ ] **`409` on a locked Tournament reads as a lock, not a conflict.** Open a Tournament from 1996 or 1997 as the Organizer. There is **no** Edit button, and the notice *"Locked — this Tournament was played more than 365 days ago…"* is visible. (To see the refusal itself, an Admin must first move a row's date past the window while another window holds the fresh copy; the message is *"…is locked. Only an administrator can still change it."*, the draft survives, and **no** Reload Latest button appears — a lock is not a version conflict.)
- [ ] **An Admin still gets the control on a locked row.** Sign in as an Admin with Power User on and open the same 1996 Tournament. The Edit button **is** offered, matching the server's Admin lock bypass — the UI never hides a control the server would accept.
- [ ] **The Season move is same-authority only, and standalone is a real option.** Edit a server Tournament: the Season dropdown lists server Seasons plus **Standalone — no Season**, and no browser-local Season ever appears in it. Pick Standalone and save; the page then shows the standalone marker instead of a Season link, and `seasonId` is `null` on the API row.
- [ ] **The status toggle is one batch too.** With the page read-only, press **Mark complete** and confirm. One `POST …/edit-batch` goes out, the status chip flips, and the version rises by one. The toggle is hidden while you are in edit mode.
- [ ] **Turning Power User off takes the controls away again.** Go to `/settings`, turn Power User off, return to the Tournament. Edit and the status toggle are gone; the read-only paragraph is back.
- [ ] **French is complete.** Switch the language to French. Edit reads `Modifier`, Cancel Edit reads `Annuler la modification`, Save Changes reads `Enregistrer les modifications`, the save dialog reads `Enregistrer les modifications du tournoi ?`, the Season option reads `Indépendant — sans saison`, and the stale message starts `Ce tournoi a changé depuis son ouverture.` No raw key such as `archiveEdit.saveChanges` may appear anywhere.
- [ ] **The legacy editor still works.** Open the legacy `/leagues-archive` surface, drill into a Tournament and stage an edit there. It behaves exactly as it did before this slice — both editors are alive until T19.
- [ ] **The console is clean.** With DevTools open, walk the whole flow above: read-only load, Edit, draft mutation, empty save, refused save, `412`, Reload Latest, status toggle, Power User off. Zero console errors.
- [ ] **Superseded by T18 — a browser-local Tournament IS now reachable from `/archive/**`.** When this section was written the new tabs listed no browser-local row and the detail route was server-only, so a local staged edit had no UI path. T18 unioned the local rows into both tabs and routed the detail read on the `local-` prefix, so the local staged edit now has a real entry point: see *T18 browser-local-union* below, which walks it end to end. The unit coverage named here — `src/app/data/archive-repository.staged-edit.test.ts` (`routes a local id to the browser store`) and the component test that classifies `ArchiveConcurrencyError` exactly like a wire `412` — still stands and still runs.
- [ ] **Known, accepted — restoring a row after a test still bumps its version.** Every write bumps `documentVersion`, including the one that puts a name back. A demo row you edited and restored will read the original name at a higher version; that is correct optimistic-concurrency behaviour, not drift.

## T18 browser-local-union

> **T19 update.** Every "the legacy surface is untouched" control in this section is retired:
> `/leagues-archive/**` and `/tournaments-archive/**` render the 404 page, `/api/leagues-archive/**`
> returns `404`, `league_archive_aggregates` is dropped and the fixed `placeholder-league` row is
> gone. Read those bullets as a record of what was true when this slice shipped; the live
> equivalents are in **T19 retire-legacy-surface** at the end of this file.


This slice makes the Archive honour ADR 0028 on the read side: the list is the **union** of the
server's records and the ones this browser authored in `gones-archive-local`, and every read routes on
the `local-` id prefix. A browser-local row is badged **Local only**, is never locked whatever its
date, is bucketed into its own calendar year on Tab 2, and is **never** written into the public
catalog cache `gones-archive-cache` — that cache may be purged, the local store may not.

It also closes the hole T14 flagged: `/archive/tournaments/:id` used to ask the server for a `local-`
id, which both leaked the id onto the wire (ADR 0028 forbids it) and rendered *not found*. The detail
read now routes on the prefix, which is what gives T17's staged editor a reachable entry point for a
browser-local Tournament.

`/archive/**` still has **no create affordance** — this slice adds no mutation surface of its own. The
only way to author a browser-local record today is the console seed below, or the legacy
`/leagues-archive` create button (a different store, `gones-leagues`).

Start from a running stack on the demo data: `npm run dev:env -- --env=demo`, then `npm run dev:serve`.
The dev server is `127.0.0.1:4200` and the local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind
fails, `pkill -f "ng serve"` and re-run.

Seed one browser-local League, Season and Tournament from the DevTools console on `127.0.0.1:4200`:

```js
await new Promise((resolve) => {
  const open = indexedDB.open('gones-archive-local', 1);
  open.onupgradeneeded = () => { for (const s of ['leagues','league-seasons','tournaments']) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s, { keyPath: 'id' }); };
  open.onsuccess = () => {
    const tx = open.result.transaction(['leagues','league-seasons','tournaments'], 'readwrite');
    tx.objectStore('leagues').put({ id: 'local-league-b', name: 'My Browser League', createdAt: '2026-08-01T00:00:00Z', documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z' });
    tx.objectStore('league-seasons').put({ id: 'local-season-b', name: 'My Browser Season', leagueId: 'local-league-b', status: 'active', documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z' });
    tx.objectStore('tournaments').put({ id: 'local-t-b', name: 'Garage Night', seasonId: 'local-season-b', tournamentDate: '2026-04-04', status: 'active', rounds: [], playerArchetypes: [], documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z' });
    tx.oncomplete = () => { open.result.close(); resolve(); };
  };
});
```

- [ ] **The five gates are green.** `npm run test` prints `Test Files 174 passed (174)` and `Tests 2293 passed (2293)` with no failed suite; `npm run typecheck` exits `0` with no output; `npm run lint` prints `All files pass linting.`; `npm run build` exits `0`. `npx cypress run --spec cypress/e2e/league-local.cy.js` prints `All specs passed!` with `7` tests and `0` failing.
- [ ] **Nothing local, nothing said.** Before seeding anything, open `/archive/league-seasons` signed out. There is no `Local only` badge anywhere and no browser-local notice — the notice is rendered only when the list actually holds a local row.
- [ ] **Tab 1 lists the browser-local Season beside the server's.** Run the seed above, reload `/archive/league-seasons`. *My Browser Season* appears in the same table as the demo Seasons, carrying a **Local only** badge, and the demo rows carry none. The one-line notice says the records live in this browser and that clearing site data deletes them. There is no error banner.
- [ ] **It is an ordinary row.** Search `browser` — only the local Season matches. Clear the search and pick *My Browser League* in the League filter — the browser League is offered in that dropdown, and selecting it leaves only the local Season. Sort by **Last played** in both directions and by **Season / League**: the local row moves through the list like any other and is never pinned to the top.
- [ ] **It is never locked.** The seeded Season has no 🔒 marker. Re-seed the Tournament with `tournamentDate: '1990-01-01'` and reload: still no 🔒 on the Season or on the Tournament, while the demo's own 1996 and 1997 Tournaments do show one. The lock keys on the id prefix, not on the date.
- [ ] **Tab 2 lists the browser-local Tournament under its own year.** Open `/archive/tournaments?year=2026`. *Garage Night* is in the table with a **Local only** badge, beside the demo's 2026 rows, and the notice is rendered once.
- [ ] **A year only this browser occupies is reachable.** Re-seed a second Tournament dated `2019-05-04`. The year dropdown now offers **2019**, which the server's index does not contain — `curl -sS http://127.0.0.1:5080/api/archive/years` lists no 2019. Select it: the 2019 local Tournament is listed alone, and with DevTools → Network filtered to `archive`, **no request is made** for that year.
- [ ] **The year filter really filters.** Switch back to 2026: the 2019 row is gone and *Garage Night* is back. No local Tournament ever appears under two years.
- [ ] **An undated record is filed, not lost.** Re-seed a Tournament with `tournamentDate: ''`. It appears under the **current** UTC year, and the notice on that page gains the sentence *"Undated Tournaments created in this browser are listed under {year}."* Select a different year: the extra sentence disappears.
- [ ] **Expanding the browser-local Season costs no request.** Back on `/archive/league-seasons`, click the expander on *My Browser Season* with the Network tab open. Its Tournaments are listed, each with a **Local only** badge, and **no** `GET /api/archive/league-seasons/local-…/tournaments` is issued. The Season's own id decides which store answers.
- [ ] **No cross-authority join.** Expand any demo Season: none of the browser-local Tournaments appears inside it. Open the browser-local Season's own page from its name link: the header carries a **Local only** badge, no 🔒, and only browser-local Tournaments are listed.
- [ ] **The detail page opens a browser-local Tournament.** From Tab 2, click *Garage Night*. The URL is `/archive/tournaments/local-t-b`, the page renders the Tournament — **not** the "Tournament not found" card — and, with the Network tab open, **no request naming `local-`** was made. Before this slice the app issued `GET /api/archive/tournaments/local-t-b` and rendered not-found on the 404.
- [ ] **The staged edit works on it, and stays in the browser.** With **Power User** on in `/settings`, click **Edit** on that page, change the name, press **Save Changes** and confirm. The heading shows the new name, no error appears, and the Network tab shows **no** `POST` to the API at all. Reload: the new name is still there. In DevTools → Application → IndexedDB → `gones-archive-local` → `tournaments`, the row's `name` is the new one and its `documentVersion` has gone up by exactly one.
- [ ] **The public cache stays pure.** After visiting both tabs and expanding the local Season, open DevTools → Application → IndexedDB → **`gones-archive-cache`** and read every store — `leagues`, `league-seasons`, `year-partitions`, `meta`. No id starts with `local-` anywhere, and no record carries an `isLocal` field. The cache is a cache; the local store is an authority; they are two databases for exactly this reason.
- [ ] **Purging the cache does not touch what you authored.** Delete the `gones-archive-cache` database from DevTools and reload both tabs. The demo rows are refetched and the browser-local rows are still listed, unchanged.
- [ ] **The archive survives with the API unreachable.** Stop the API (`docker compose stop api`) and reload `/archive/league-seasons` and `/archive/tournaments`. Both tabs still list the browser-local records, neither shows the red error banner, and the sync bar reports the stale state. Start the API again afterwards.
- [ ] **French is complete.** Switch the language to French. The badge reads `Local uniquement`, its tooltip reads `Stocké uniquement dans ce navigateur — jamais envoyé au serveur`, and the notice starts `Les enregistrements créés hors connexion sont stockés uniquement dans ce navigateur.` No raw key such as `archive.localBadge` may appear anywhere.
- [ ] **The legacy surface is untouched.** `/leagues-archive`, a legacy League page and a legacy Tournament page all still load and still work, and the fixed `placeholder-league` row is still there. The legacy list keeps its own `Local only` badge, which reads from the other store (`gones-leagues`) and is a different feature.
- [ ] **The console is clean.** With DevTools open, walk the whole flow above: both tabs, the year filter, the expansion, the Season page, the detail page, the staged edit, the cache purge and the offline reload. Zero console errors.
- [ ] **Known, accepted — `/archive/**` still has no create affordance.** A browser-local record can only be authored through the console seed above or through the legacy `/leagues-archive` create button, which writes the other store. This slice is a read-path union plus the detail route; the create affordance is not in it.
- [ ] **Known, accepted — the rankings scope picker still offers browser-local scopes that read empty.** On `/global-stats`, a browser-local League or Season can be selected and returns an empty scope, because the server holds no rating for a record it has never seen. That is the empty-scope path behaving as designed. Narrowing the picker is a rankings change and this slice is explicitly forbidden from touching `/global-stats`.

## T19 retire-legacy-surface

The contract step of expand → migrate → contract, and the only slice in this plan allowed to delete.
The `/leagues-archive/**` and `/tournaments-archive/**` pages, the `/api/leagues-archive/**` endpoints,
the `LeagueArchiveAggregate` and its `league_archive_aggregates` table, the fixed `placeholder-league`
row and the browser database `gones-leagues` are all gone. Nothing is aliased and nothing redirects:
ADR 0022's "no API path aliases" clause is reaffirmed, its "frontend redirects, yes" clause is
reversed, because Gones is unreleased with zero users and there is no bookmark to protect.

Two ADR 0022 exclusions still hold. `/api/maintenance/player-names*` keeps every route, request shape,
response shape, status code and audit action string — only the table it reads moved to
`archive_tournaments`. `LiveFinalizeResponse` keeps every field name it has, `leagueId` included; a
Live tournament that names no League now finalizes to a **standalone** Archive Tournament
(`season_id IS NULL`) instead of being absorbed by the placeholder League.

Start from a running stack on the demo data: `npm run dev:env -- --env=demo`, then
`docker compose up -d --wait frontend-development` (or `npm run dev`). The dev server is
`127.0.0.1:4200` and the local API is `127.0.0.1:5080`. If the `127.0.0.1:4200` bind fails,
`pkill -f "ng serve"` and re-run. `HEAD` is unmapped app-wide, so probe with `curl -sS -D- <url>`.

- [ ] **The six gates are green.** `npm run api:check` exits `0`; `npm run lint` prints `All files pass linting.`; `npm run typecheck` exits `0`; `npm run test` prints `Test Files 160 passed (160)` / `Tests 2025 passed (2025)`; `npm run backend:test` passes 329 unit, 20 architecture and 621 integration tests with `Failed: 0`; `npm run e2e:ci` exits `0` and its tail prints `=== e2e specs: 26/26 passed ===` with no `FAIL` line.
- [ ] **Every retired API path answers 404.** `for p in /api/leagues-archive /api/leagues-archive/all /api/leagues-archive/placeholder-league /api/leagues-archive/global-player-statistics/all /api/leagues; do curl -sS -o /dev/null -w "$p %{http_code}\n" "http://127.0.0.1:5080$p"; done` prints `404` for all five. No problem-details body, no `code`, no deprecation header.
- [ ] **The new API surface answers 200 with its caching contract.** `curl -sS -D- -o /dev/null http://127.0.0.1:5080/api/archive/leagues/all` prints `HTTP/1.1 200 OK`, a `Cache-Control: public, max-age=3600` and an `ETag`. The same holds for `/api/archive/league-seasons/all`, `/api/archive/tournaments/all?year=2026`, `/api/archive/years` and `/api/archive/global-player-statistics/all`.
- [ ] **`?year=` is required, not optional.** `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/api/archive/tournaments/all` prints `400` and the body names `Query parameter 'year' is required.` A year partition is the unit of transfer.
- [ ] **Every retired page renders the 404 page with no redirect.** Visit `/leagues`, `/leagues-archive`, `/leagues-archive/x`, `/leagues-archive/x/tournaments-archive/y`, `…/result` and `…/result/metagames`. Each shows the not-found page **and the address bar still shows the path you typed** — a redirect would rewrite it, so an unchanged path is the proof that no alias fired.
- [ ] **The new surface renders from the real API.** `/archive/league-seasons` lists the demo Seasons, `/archive/tournaments` lists a year of Tournaments, `/global-stats` lists the rankings. No error banner, no red console error.
- [ ] **The retired browser database is deleted on sight.** In the DevTools console run `indexedDB.open('gones-leagues', 1)` to recreate it, then reload any page. `indexedDB.databases().then(d => console.log(d.map(x => x.name)))` now lists `gones-archive-local` and `gones-archive-cache` and **not** `gones-leagues`. Reload again: still absent, and no console error — the purge is idempotent and never throws.
- [ ] **The table is dropped, and by exactly one migration.** `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select to_regclass('league_archive_aggregates');"` prints an empty line. `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select tablename from pg_tables where schemaname='public' and tablename like 'archive%' order by 1;"` prints `archive_league_seasons`, `archive_leagues`, `archive_tournaments`. `grep -c CreateTable backend/src/Gones.Infrastructure/Persistence/Migrations/*_RetireLegacyLeagueArchive.cs` counts one, and it is inside `Down`.
- [ ] **It applies on an empty database.** `docker compose down --volumes --remove-orphans && docker compose up -d --wait postgres && docker compose build migrator && docker compose run --rm migrator database update` exits `0` and applies exactly four migrations, ending `20260825185219_RetireLegacyLeagueArchive`. (The `Cannot load library libgssapi_krb5.so.2` line is a pre-existing Npgsql GSSAPI probe, not a failure.)
- [ ] **The seed scripts no longer need the placeholder.** `npm run db:reset` prints `Deterministic V1 seed complete.` and `Local stack reset to deterministic seeded state.`; `npm run db:seed` prints `Deterministic V1 seed complete.` Neither mentions a placeholder League.
- [ ] **The legacy-browser import door still works without one.** `npm run migration:smoke` exits `0` and prints `C38 migration smoke passed over 2 browser origins…`. Its census now counts `archive_league_seasons`; a bundle's Tournaments that used to merge into `placeholder-league` are imported standalone with `season_id = NULL`.
- [ ] **Live keeps its wire contract.** In the app, run a Live tournament to standings and archive it. The finalize response still carries `leagueId`, `finalizedTournamentId`, `liveDocumentVersion`, `liveETag`, `leagueDocumentVersion` and `leagueETag`; the browser lands on `/archive/tournaments/<finalizedTournamentId>` and the page renders. `POST /api/live-tournaments` with an unknown `leagueId` still answers `400` / `validation_failed` / field `leagueId` / `League was not found.`
- [ ] **A Live tournament with no League finalizes standalone.** Archive a Live tournament whose League field is empty. `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select season_id is null from archive_tournaments order by updated_at desc limit 1;"` prints `t`. It appears on `/archive/tournaments` under its own year with an empty League column, and it contributes to the **global** rankings scope only.
- [ ] **Player-name maintenance is byte-identical.** Signed in as an Organizer, open `/settings`, search a player name, run a rename preview and then a rename. The preview counts match the commit counts, the rename applies to every Tournament that names the player, a soft-deleted Tournament is untouched, and the audit rows still carry the action `maintenance.player_name.renamed`.
- [ ] **The player page still lists a history.** Open a player from `/global-stats`. Their Matches list, and a Match played in a **standalone** Tournament shows an empty League name rather than a placeholder one.
- [ ] **The cross-stack domain parity corpus survived the deletion.** `fixtures/archive-domain/v5/parity/parity.json` and `manifest.json` exist, `UPDATE_ARCHIVE_PARITY_FIXTURES=1 npx vitest run src/app/domain/archive-parity-fixtures.test.ts` is green, and `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~LeagueParityTests` passes 3 facts. `fixtures/league-domain/` is gone.
- [ ] **The guards are armed.** `npx vitest run src/app/shared/retired-archive-surface.test.ts` passes 6 cases and `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~RetiredLeagueArchiveSurfaceTests` passes 2. Re-add the string `leagues-archive` to any non-test file under `src/app/` and the first suite goes red; remove it again.
- [ ] **The invalidation funnel still bites.** In `src/app/data/archive-repository.service.ts`, temporarily move `restoreBundle` out of `mutating()`. `npx vitest run src/app/data/archive-cache-invalidation.test.ts` fails with `expected [ 'restoreBundle' ] to deeply equal []`. Put it back and the suite is green again.
- [ ] **The docs carry the three-tier vocabulary and link to no working file.** `docs/CONTEXT.md` has entries for **Archive**, **League** (archive tier), **LeagueSeason**, **Archive Tournament** and the retired **Unassigned Tournaments**, each with its `_Formerly_` note. `grep -c "artifacts/\|\.tmp/" docs/CONTEXT.md docs/GLOSSARY.md` prints `0` for both. `docs/local-dev-environments.html` lists the three `archive-*.json` fixture files and `POST /api/archive/restore-full`, and names no `leagues.json`.
- [ ] **The console is clean.** With DevTools open, walk the whole flow: both archive tabs, a Season, a Tournament, its result page, `/global-stats`, a player page, `/settings`, a Live tournament and one retired URL. Zero console errors.
- [ ] **Known, accepted — no create-from-scratch affordance survives anywhere.** The archive had exactly one create button and it lived on the retired `/leagues-archive` page. `/archive/**` never grew one (T13–T18 were read-path slices and T19 is forbidden to add behaviour), so **importing a v5 bundle through the header Import control on `/archive/league-seasons` is now the only way to put a record into the archive from the browser**, alongside the server-side commands and Live finalize. This is a real capability gap, not an oversight of this checklist: it needs its own follow-up slice.
- [ ] **Known, accepted — the header Gones Export writes browser-local records only.** `downloadFullExport` builds its v5 bundle from `gones-archive-local` and refuses for a signed-in visitor whose archive lives on the server, because the three-tier read surface serves slim catalogs and one document per Tournament and has no whole-archive server read to build the other half from. A signed-in Admin who wants a full backup must use the server-side path. Also a follow-up slice.
- [ ] **Known, accepted — the Tournament detail route costs two identical reads per load.** `/archive/tournaments/:id` is read once by the page and once by the app shell, which needs the Tournament for its header label, and the shell reads it again after every archive mutation so the header follows a rename. Sharing one read between them is new behaviour and this slice is forbidden from adding any.
- [ ] **Known, accepted — some dated records still name the retired surface.** `docs/RUNTIME_CONTRACT.md`'s compression table, `docs/league-archive-catalog-summary.html`, `docs/ttl-cache-contract.html`, `docs/archive-three-tier.html`, `docs/event-vocabulary-rename.html` and `docs/RELEASE_NOTES_V1.md` record measurements and decisions taken against routes that existed at the time. Relabelling them would misattribute measurements that were never taken on the new routes, so they are left as written, exactly like an ADR.

## Post-review fixes

The three accepted findings of the post-plan review: the Season catalog could answer `304` over a body
whose dates had moved, a migration-imported Season kept the counters `Create` stamped at zero for ever,
and the rankings scope picker offered browser-local records whose `local-` id would have gone on the
wire (ADR 0028).

Start from a running stack on the demo data: `npm run dev:env -- --env=demo`, then
`docker compose up -d --wait frontend-development` (or `npm run dev`). The dev server is
`127.0.0.1:4200` and the local API is `127.0.0.1:5080`. `HEAD` is unmapped app-wide, so probe with
`curl -sS -D- <url>`. Capture the catalog ETag with
`curl -sS -D- -o /dev/null http://127.0.0.1:5080/api/archive/league-seasons/all | grep -i '^etag:'` and
replay it with
`curl -sS -o /dev/null -w '%{http_code}\n' -H 'If-None-Match: <etag>' http://127.0.0.1:5080/api/archive/league-seasons/all`.

- [ ] **A moved boundary date expires the Season catalog.** Note a Season's `firstTournamentDate` and `lastTournamentDate` in `/api/archive/league-seasons/all` and capture the ETag. Signed in as an Admin, open one of that Season's Tournaments on `/archive/tournaments/<id>`, stage a date change that falls outside the pair, and apply it. The replay prints `200`, the fresh body carries the new date, and `tournamentCount` and `playerCount` are unchanged — those are the inputs that used to be the whole stamp.
- [ ] **Moving a Tournament between two Seasons expires it too.** Capture the ETag, then move a Tournament from Season A to Season B (both rows keep their `playerCount` if the rosters already overlap). The replay prints `200`, A's `tournamentCount` is one lower and B's one higher. The two deltas cancel in a sum, which is exactly the write the old stamp could not see.
- [ ] **A write that changes no counter still answers 304.** Capture the ETag, then re-apply a Tournament edit batch that changes nothing (save the staged editor with no field touched, or replay the same request with its idempotency key). The replay prints `304` and the ETag header is byte-identical — the fix must not expire every client's catalog on every Tournament write.
- [ ] **The browser follows the moved dates.** After the first step, reload `/archive/league-seasons`, expand the Season and confirm its Tournaments still list, including the re-dated one in its new year. A stale date pair sends the expansion to the wrong cached year partitions, so the row would come back short or empty.
- [ ] **An imported Season prints real counters.** Run `npm run migration:smoke` (or a real `migrator import`), then `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select document_id, tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version from archive_league_seasons order by updated_at desc limit 5;"`. Every imported Season that owns Tournaments prints a non-zero `tournament_count`, a non-zero `player_count`, a real date pair and `counts_version` `1`. Before the fix all four printed `0`/`NULL`, and no command ever repaired them.
- [ ] **An imported Season expands to its Tournaments.** On `/archive/league-seasons`, expand a Season that came from that import: its Tournaments render. With the null date pair the expansion used to resolve to an empty year set and answer nothing without ever asking the server.
- [ ] **The rankings scope picker offers no browser-local record.** Signed out — the browser-local authority — import a v5 bundle through the header Import control on `/archive/league-seasons`, and confirm the imported League and Season appear in both archive tabs. Then open `/global-stats`: neither select offers them. With the DevTools Network tab open, walk every offered League and Season scope and confirm no request to `/api/archive/global-player-statistics` carries a `scopeId=local-…`. The dropped scope could only ever have rendered an empty table — the server holds no statistics for a record it has never seen.

## T1 organizer-lookup-visibility

The browser leg of this slice is Cypress only (`cypress/e2e/organizer-participants.cy.js`), and
`npm run e2e:ci` is banned for this run — its teardown destroys the local DB volumes. That spec mocks
every API call, so it runs against a bare dev server: `npx ng serve --host 127.0.0.1` in one shell,
`npx cypress run --spec cypress/e2e/organizer-participants.cy.js` in another — no stack, no volume
touched. Everything the Cypress spec cannot prove is here. Run the stack with
`docker compose up -d --wait frontend-development` (dev server `127.0.0.1:4200`, API
`127.0.0.1:5080`) and sign in as an Organizer of one organization.

- [ ] **A stranger's account is invisible.** On `/organizer/events/<id>/participants`, look up the exact username of a verified account that has never registered for one of your organization's events and is not a member of it. The panel reports "not found" — the same message as a username nobody owns.
- [ ] **Email is not an existence oracle.** Repeat the lookup by email for that same stranger, and again for an address with no account at all. In DevTools Network, both replies are `404` with the same `application/problem+json` body apart from `traceId` — nothing tells the two cases apart.
- [ ] **A related account still resolves, by username only.** Look up a member of your organization, then someone who registered for one of its events and later cancelled. Both resolve, the selection panel shows only the username, and the `200` body in DevTools has exactly `userId` and `username` — no `email`, `firstName` or `lastName`.
- [ ] **The add flow still completes.** With a related account selected, press Add. The POST to `/api/events/<id>/registrations/by-organizer` carries `{ "userId": "…" }` only, and the participant appears in the table below.
- [ ] **A platform Admin resolves anyone, and still learns nothing extra.** Signed in as an Admin who is *not* a member of the organization, look up the stranger from the first step. It answers `200` — the relatedness rule is bypassed for Admins by design — and the body is still exactly `userId` and `username`.
- [ ] **The route is rate limited.** Replay the lookup faster than 10 times a minute as the same user (`for i in $(seq 14); do curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <token>" "http://127.0.0.1:5080/api/organizations/<orgId>/users/lookup?username=<a related username>"; done`). From the 11th call in the window the answer is `429`, `content-type: application/problem+json`, `Retry-After: 60`. Compose runs the API with `ASPNETCORE_ENVIRONMENT=Production`, so the `registration-user` limit is the real 10 per minute per user with no override needed — only Development and Testing relax limits, and never this one. The bucket is shared with `POST /api/events/<id>/registrations/by-organizer`, so an add spent in the same minute brings the `429` one call sooner.

## T2 meter-authenticated-reads

The global limiter used to bucket only admin traffic, anonymous reads and authenticated writes, so
an authenticated `GET`/`HEAD` to any non-admin `/api` route fell through to `GetNoLimiter` and
shipped unmetered. Two integration tests in
`backend/tests/Gones.IntegrationTests/RateLimitPolicyTests.cs` prove the new bucket against the
Testing-only probe route; what is here is what they cannot prove — the real
`ASPNETCORE_ENVIRONMENT=Production` limit of 120 per minute per user against a real signed-in
session. Run the stack with `docker compose up -d --wait frontend-development` (dev server
`127.0.0.1:4200`, API `127.0.0.1:5080`) and sign in as an Organizer who owns at least one Event with
participants. The probe route below, `GET /api/events/<eventId>/registrations`, is the
participant list the audit named: authenticated, carries email and legal name, and declares no
endpoint policy of its own, so the global bucket is the only thing metering it.

- [ ] **Normal use is not throttled.** Browse the app as the signed-in Organizer for a minute —
      Calendar, Event detail, the participants panel, back and forth. Nothing returns `429`; 120
      reads a minute is well above what the UI issues (the frontend has no polling timer).
- [ ] **The bucket fires.** Replay the participant list faster than 120 times a minute as the same
      user
      (`for i in $(seq 125); do curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <token>" "http://127.0.0.1:5080/api/events/<eventId>/registrations"; done | sort | uniq -c`).
      The count shows 120 `200` and 5 `429`. Compose runs the API with
      `ASPNETCORE_ENVIRONMENT=Production`, so no override is needed — only Development and Testing
      relax the volume buckets.
- [ ] **The rejection is the uniform one.** Re-run one throttled call with `-i`. The reply is `429`
      with `content-type: application/problem+json`, a body whose `code` is `rate_limited`, and a
      `Retry-After` header that is a positive whole number of seconds no greater than `60`.
- [ ] **No cross-user leakage.** With the first user's bucket exhausted, sign in as a second account
      (any other Organizer or Admin) and load the same participant list. It answers `200` — the
      partition is keyed per user id, not per IP, even though both calls come from your machine.
- [ ] **Anonymous reads keep their own bucket.** While the first user is still throttled, request a
      public route with no `Authorization` header
      (`curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5080/api/events"`). It answers
      `200`: anonymous traffic stays in the `public-read` bucket at 120 per minute per client IP.
- [ ] **Existing buckets are untouched.** Confirm the admin surface still allows 60 reads a minute
      per user (`/api/admin/**`, signed in as an Admin) and that an authenticated write still trips
      at 30 a minute — the new bucket sits between them in the partitioner and must not have
      swallowed either.
- [ ] **The override works.** Stop the stack, set `GONES_RATE_LIMIT_AUTHENTICATED_READ_PERMIT_LIMIT=5`
      in the API service environment, bring it back up, and repeat the second step with `seq 8`. The
      6th call onward answers `429`. Unset it again afterwards. Note that `compose.yaml` does not
      pass this key through by default — its rate-limit passthrough list is deliberately partial —
      so add it to the `api` service's `environment:` block for the duration of this check only.

## T3 organizer-archive-import-route

`ArchiveRepository.restoreBundle` used to send every server-bound import to `/api/archive/restore-full`,
which the API gates behind `AuthorizationPolicies.Admin`
(`backend/src/Gones.Api/Archive/ArchiveTournamentCommandEndpoints.cs:48-51`), so an Organizer's import
answered `403` and wrote nothing anywhere while the Organizer-legal sibling `/api/archive/restore` had
no caller in `src/`. Three vitest tests in `src/app/data/archive-repository.service.test.ts` now pin the
routing decision at the repository seam (Organizer → `archiveRestore`, Admin → `archiveRestoreFull`,
everyone else → the browser-local store), but they stub the generated client, so nothing automated in
this run proves the real request reaches a route the Organizer's session is allowed on. The composed
flow is browser-only and `npm run e2e:ci` is banned for this run — its teardown destroys the local DB
volumes. What is here is what the vitest tests cannot see.

Run the stack with `docker compose up -d --wait frontend-development` (dev server `127.0.0.1:4200`,
API `127.0.0.1:5080`). Turn Power User mode on in Settings ("Enable Power User mode") — `importLeague`
returns silently without it — and note the Import control only renders on `/archive/league-seasons`.
The repo fixture cannot be imported as-is: `parseArchiveBundle` rejects any top-level key outside
`version`/`checksum`/`leagues`/`leagueSeasons`/`tournaments`/`calendarEvents`, and
`fixtures/archive-domain/v5/bundle.json` carries `"kind": "fullArchive"` and no `calendarEvents`. Make
an importable copy once (no checksum needed — `verifyArchiveChecksum` accepts an artifact that carries
none):

```bash
python3 -c "import json;d=json.load(open('fixtures/archive-domain/v5/bundle.json'));d.pop('kind');d['calendarEvents']=[];json.dump(d,open('/tmp/gones-v5-bundle.json','w'))"
```

- [ ] **An Organizer's import lands instead of answering 403.** Signed in as an Organizer with DevTools
      Network open, go to `/archive/league-seasons` and import `/tmp/gones-v5-bundle.json` through the
      header Import control. Exactly one `POST` to `/api/archive/restore` answering `201`, no request to
      `/api/archive/restore-full`, and no red *"Your account is not allowed to change League or Result
      data."* Before this fix that message was the only possible outcome.
- [ ] **The body's `kind` matches the route it was sent to.** In that request's payload, `kind` is
      `"archive"` and `version` is `5`, and the request carries an `Idempotency-Key` header. The two move
      together: a `fullArchive` body on `/restore` answers `400` with `Expected archive export.`, so that
      reply means the discriminator and the route came apart.
- [ ] **The imported records land server-side and the page repaints on its own.** The 8 Leagues and 12
      Seasons of the fixture appear without a manual reload (the restore runs through `mutating`, which
      fires `gones-archive-updated`). Confirm the write really reached Postgres, not just the UI:
      `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*) from archive_leagues;"`
      grew by 8, and
      `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select action, count(*) from audit_records where action like 'archive.%.restored' group by action;"`
      prints `archive.league.restored`, `archive.league-season.restored` and `archive.tournament.restored` rows.
- [ ] **An Admin still takes the Admin-only route.** Sign in as a platform Admin and import the same file.
      The request goes to `/api/archive/restore-full` with `kind: "fullArchive"` and answers `201`; nothing
      hits `/api/archive/restore`. This path is the one that already worked — it must not have moved.
- [ ] **A signed-out browser still writes locally and asks the server nothing.** Sign out, import the same
      file, and confirm the records appear in both archive tabs with `local-` prefixed ids while the Network
      tab shows no `/api/archive/**` request at all. A plain `User` behaves the same way: only an Organizer
      or an Admin resolves to the server (`createArchiveTarget`), so no other role can reach either route.
- [ ] **A second import duplicates rather than replays — that is expected, not a regression.** Import the
      same file twice as the Organizer. A fresh `Idempotency-Key` is minted per click, so the second import
      creates a second set of records whose names carry a uniqueness suffix. Only a replay of the *same*
      key deduplicates.
- [ ] **A server rejection still surfaces to the user instead of being swallowed.** With the Organizer
      signed in, stop the API (`docker compose stop api`), then import the file. An error message appears
      under the Import control, the page adds no records, and re-starting the API
      (`docker compose start api`) followed by a retry succeeds. The failure path is unchanged by this
      slice: both routes reject through `firstValueFrom` into the existing classifier.

## T4 server-standalone-finalize

`finalize()` decided "this was a browser-local finalize" from an empty `leagueId`. That sentinel stopped
being local-only at commit `4e3eafe`: the server now archives a Season-less Live Tournament as a
standalone Archive Tournament and returns `leagueId: ""` too, so an Organizer finalizing without a League
got a JSON download while the server had already archived the Tournament — and the Archive Tournaments
tab kept serving its cached list until the 24h TTL lapsed. The discriminator is now the authority mode
(`LIVE_BACKEND_MODE`), pinned by
`src/app/features/live-tournaments/live-tournament-cache-invalidation.test.ts`. Those unit tests use
hand-written fakes, so the download, the cache drop and the real navigation are what is left here. Run
the stack with `docker compose up -d --wait frontend-development` (dev server `127.0.0.1:4200`, API
`127.0.0.1:5080`). Authority follows the role: signed out or a plain `User` is `browser-local`, an
Organizer or Admin is `aspnet-api` — resolved once at bootstrap, so switch accounts with a full reload.

- [ ] **A Season-less server finalize lands in the Archive instead of the Downloads folder.** Signed in as an Organizer, create a Live Tournament and leave the League select on unassigned. Play it to standings, press Archive and confirm. The app navigates to `/archive/tournaments/<id>` and shows the finished Tournament; no file is written to the browser's download directory, and no "finalized locally" notice appears on the runner.
- [ ] **The Archive Tournaments tab shows it immediately, not in 24 hours.** From that Result page, go to the Archive Tournaments tab. The new Tournament is listed on the first load — no hard refresh, no waiting out the cache. (Before this fix the tab kept serving its cached list; if the Tournament is missing here, `invalidateArchiveCaches()` did not run.)
- [ ] **A finalize into a Season still behaves exactly as before.** Repeat with a League selected. The app navigates to the archived Tournament, it appears under its Season in the Archive, and again nothing is downloaded.
- [ ] **The browser-local finalize still hands over the JSON.** Sign out (or sign in as a plain `User`) and reload so the authority re-resolves. Create a Live Tournament in the browser-local store, play it to standings and Archive it. A `gones-live-tournament-<date>.json` file is offered for download, the runner shows the local-finalized state, and the app stays on the runner — it must not navigate to `/archive/tournaments/…`.
- [ ] **The downloaded file is still the real archived Tournament.** Open that JSON: it holds the finished Tournament document with its standings, matching what the server would have archived. This slice did not change the local adapter, so a regression here means the download payload broke, not the routing.
- [ ] **A failed finalize still reports instead of navigating.** Signed in as the Organizer again, stop the API (`docker compose stop api`), then press Archive on a Live Tournament. An error appears on the runner, the page does not navigate, and no download is triggered; restart with `docker compose start api` and retry to confirm the tournament finalizes normally. The `catch` in `finalize()` is untouched by this slice — this checks the fix did not reroute a failure into the success path.

## T5 migration-verify-order

The migration importer hashed each League **as the bundle listed it** but re-hashed it after import
**sorted by Tournament id**, so any legacy bundle whose `leagues[].tournaments` array was not already
ascending-ordinal — newest-first is the obvious one — got `league <id> canonical hash differs` and exit
code 4 (`imported-verification-failed`) *after* the single import transaction had already committed. On a
one-way-door tool that reads as "your migration is corrupt" when nothing is wrong. Both sides now go
through one method, `MigrationPlanner.CanonicalLeagueHash`, which sorts `Tournaments` ascending by id
with `StringComparer.Ordinal` on a copy before serializing. A League whose tournaments were already in
order hashes byte-identically to before, so stored data and previously-accepted ordered reports are
unaffected. `backend/tests/Gones.IntegrationTests/MigrationImportServiceTests.cs`
(`Verification_passes_when_bundle_tournaments_are_listed_in_descending_id_order`) and
`backend/tests/Gones.UnitTests/MigrationPlannerTests.cs`
(`Canonical_league_hash_ignores_tournament_order`) pin it. The automated fixtures use a synthetic bundle
written by the test itself, so the real CLI against the real database is what is left here. `npm run
migration:smoke` still builds a **single**-tournament league, so it does not exercise this path — the
descending bundle below has to be hand-made. Bring the stack up with
`docker compose up -d --wait api` and run the migrator as the smoke script does:
`docker compose run --rm -v <fixtures-dir>:/fixtures:ro migrator import --bundle /fixtures/<file> --manifest /fixtures/manifest.json --mapping /fixtures/mapping.json [--dry-run|--accept-report-hash <hash>]`.

- [ ] **A newest-first bundle imports and verifies cleanly.** Take a private-migration-bundle fixture and
      give one League two tournaments listed **descending** by id (`tournament-2` before `tournament-1`),
      with `counts.tournaments: 2` and a recomputed `bundleChecksum`. Run the import with `--dry-run`,
      copy the `Report hash:` line, then rerun with `--accept-report-hash <that hash>`. The command exits
      **0** and the report says verification passed with 1 League verified. Before this fix the same
      bundle exited 4 with `league <id> canonical hash differs` even though every row imported correctly.
- [ ] **Both tournaments are actually there, not just hash-equal.** After that import, query the database:
      `docker compose exec db psql -U gones -d gones -c "select document_id, season_id from archive_tournaments where season_id = '<leagueId>' order by document_id"`.
      Both `tournament-1` and `tournament-2` are present under the League. An order-insensitive hash must
      not be able to hide a missing Tournament — if only one row is listed, the fix is masking a real bug.
- [ ] **An already-ordered bundle produces the exact same report hash as before the fix.** With the
      unmodified single-tournament smoke fixture, run `--dry-run` on this commit and note the
      `Report hash:`. Check out the previous commit, rebuild the migrator, run the identical `--dry-run`,
      and compare. The two hashes are **identical**. This is the compatibility claim: operators holding an
      accepted report for an ordered bundle do not have to redo their dry run.
- [ ] **A genuine mismatch still fails loudly.** Import a bundle successfully, then edit one imported
      Tournament's stored document directly in the database (change a player name in
      `archive_tournaments.document`), and re-run verification by importing the same bundle into a fresh
      database that you then tamper with the same way. Verification must still report
      `league <id> canonical hash differs` and exit **4**. The fix removes a false positive only; it must
      not blunt the detector.
- [ ] **Known, accepted — a dry run taken with the pre-fix binary against an *unordered* bundle is stale
      after upgrading.** For unordered bundles only, the report hash changes with this fix (it was
      computed over the wrong order before). If an operator runs `--dry-run` on the old binary and then
      `--accept-report-hash` on the new one, the import stops at exit **3** with the `--accept-report-hash`
      message and writes nothing. That is the designed safe-fail: re-run the dry run on the new binary and
      accept the fresh hash. Ordered bundles and already-imported batches are unaffected — the batch
      identity comes from `ComputeBatchHash(bundles, manifest, mapping)`
      (`backend/src/Gones.Application/Migration/MigrationPlanner.cs:69`), which this change does not touch,
      so a batch already imported still returns its stored result instead of re-importing.
- [ ] **The full migration smoke still passes.** Run `npm run migration:smoke`. It is green end to end.
      Note its teardown tears down the Docker stack and destroys local DB volumes — run it when you are
      ready to lose local data, not mid-session.

## T6 v5-import-refusal-messages

Every v5 import refusal used to render the generic `msg.importFailed` line ("Could not import that
Gones Export. Please try again.") because `importErrorMessage` still matched the retired v1–v4 error
strings. It now matches what the v5 gate actually throws. Nothing else on the import path moved: the
gate, the repository and the template binding are untouched, so the control for every check below is
that the *same* header error line renders — only its text changes.

Setup for all of them: `npm start`, open the app, Settings → turn **Power User** on (`data-cy="settings-power-user-card"`),
then go to `/archive/league-seasons` and use the header **Import** button (`data-cy="app-leagues-import-button"`,
file input `data-cy="header-import-input"`). Build each fixture as a plain `.json` file on disk. A
bundle with **no `checksum` key at all** is accepted by the checksum step on purpose
(`verifyArchiveChecksum` returns true when the field is absent), so none of the fixtures below needs a
recomputed hash — which is what makes them hand-writable.

- [ ] **A v1–v4 Gones Export is refused as legacy, not as "try again".** Import a file containing
      `{"kind":"fullData"}`, then repeat with `{"version":4}` and with `{"version":1,"league":{}}`.
      Each time the header shows *"That file is a Gones Export from an older data version (1 to 4).
      Only version 5 archive bundles can be imported, and there is no converter."* Before this fix all
      three showed "Could not import that Gones Export. Please try again." This message existed in both
      catalogs but rendered nowhere.
- [ ] **A malformed v5 file is refused as unsupported.** Import
      `{"version":5,"leagues":[{"id":1}],"leagueSeasons":[],"tournaments":[],"calendarEvents":[]}`
      (the League row's `id` is a number and its `name`/`createdAt` are missing). The header shows
      *"That file is not a supported Gones Export."*
- [ ] **A bundle over a record ceiling says so.** Import a file whose `leagues` array holds **101**
      entries — each `{"id":"l-<n>","name":"L <n>","createdAt":"2026-08-09T10:00:00.000Z"}` — with
      `"version":5` and empty `leagueSeasons`/`tournaments`/`calendarEvents`. The cap is 100 Leagues
      (also 100 LeagueSeasons, 2000 Tournaments, 500 CalendarEvents). The header shows *"That Gones
      Export contains too many records for browser import."* Note the copy is new: the old key
      `msg.importTooManyLeagues` ("That Full Data Export contains too many Leagues…") is gone, because
      the ceiling applies to four collections, not just Leagues.
- [ ] **The two refusals that already worked still work.** (a) Import any file larger than 2 MiB →
      *"That Gones Export is too large to import in the browser."* (b) Take a real export from the
      header's **Full Data Export** button, edit one League `name` inside it while leaving its
      `checksum` line untouched, and import it → *"This Gones Export checksum does not match its
      content. The file is corrupted or was modified."*
- [ ] **The non-bundle failure paths are unchanged.** Import a file containing `not json at all` →
      *"That file is not valid JSON."* This one matters because `SyntaxError` is an `Error`: if the new
      branches were ordered wrongly it would have been swallowed by one of them.
- [ ] **A good import still imports.** Export with **Full Data Export**, then import that exact file
      back. It succeeds, the error line stays empty, and the Leagues/Seasons/Tournaments you had are
      still listed. The refusal mapping must not have made a valid bundle refusable.
- [ ] **French renders the same six outcomes.** Switch the language to French in Settings and repeat at
      least the legacy, malformed and over-cap fixtures. Expect *"Ce fichier est un export Gones d’une
      version de données antérieure (1 à 4)…"*, *"Ce fichier n’est pas un export Gones pris en
      charge."* and *"Cet export Gones contient trop d’enregistrements pour l’import navigateur."* No
      English fallback and no raw key text such as `msg.importTooManyRecords` may appear — the rename
      landed in both catalogs in the same commit, so a missing French line would show up here.
- [ ] **The file input recovers after a refusal.** Right after any refusal above, pick the *same* file
      again. The error line re-renders rather than staying stale/silent (`importLeague` clears
      `input.value` in its `finally`), and picking a valid bundle afterwards clears the error.

## T7 season-counts-lost-update

Backend-only concurrency fix: the `archive_league_seasons` row is now locked `FOR UPDATE` before its
Tournaments are counted, at both recount sites (`RecomputeSeasonCountsAsync` in the archive Tournament
commands, `RefreshSeasonCountsAsync` in the Live finalize). Automated coverage is the new integration
test `Tournament_delete_racing_another_delete_keeps_the_Season_counts_exact`; these steps are the human
confirmation that single-writer behaviour and the Live path are untouched in a real app.

- [ ] **Single-writer counters are unchanged.** As an Organizer, open a League Season that already has
      Tournaments. Create a Tournament in it, then edit it, then move it to another Season, then delete
      it. After each step the Season's Tournament/player counts and first/last dates on the archive
      catalog screen match what they did before this change — one write, one correct recount, no error
      and no visible slowdown.
- [ ] **The counters land after a Live finalize.** Run a Live tournament attached to a Season through to
      **Finalize**. The finalized Tournament appears in that Season and the Season's Tournament count
      goes up by exactly one, with the first/last tournament dates widening to include it.
- [ ] **A standalone Live finalize still works.** Finalize a Live tournament that has **no** Season. It
      finalizes normally and no Season row is touched — the `seasonId is null` early return must still
      short-circuit before any lock is taken.
- [ ] **Two writers on one Season do not lose a count.** Open the same League Season in two browser
      windows signed in as Organizer. In window A start deleting one Tournament and in window B delete a
      different Tournament in that same Season at essentially the same moment. Both deletes succeed, and
      after both finish the Season's Tournament count has dropped by **two**, not one. Reload the page to
      confirm the stored value (not just the cached view) is right.
- [ ] **Nothing hangs under the new lock.** Repeat the two-window delete a few times, and also try two
      simultaneous Tournament *moves* in opposite directions between the same two Seasons (A→B in one
      window, B→A in the other). Every request returns — no request spins forever and no `500` from a
      deadlock; the slower writer simply waits for the faster one.
- [ ] **A Season deleted underneath a Tournament write is still a skip, not an error.** Delete a Season,
      then delete a Tournament that pointed at it. The Tournament delete returns success rather than a
      `404`/`500` — the "Season row absent → skip the recount" behaviour is deliberate and unchanged.

## T8 blocked-site-data-fallback

Frontend-only startup fix: the app initializer now calls `runAuthBootstrap(inject(AuthService))`
(`src/app/auth/auth-bootstrap.ts`) instead of `AuthService.bootstrap()` directly. A browser that blocks
site data for the origin — or has no Web Locks API — makes session coordination unavailable, and that
used to reject the initializer, abort `bootstrapApplication` and leave a white page even on the public
surfaces. The wrapper swallows exactly `AuthCoordinationUnavailableError`, logs it as a structured
boundary error, and lets the app boot anonymously. Automated coverage is
`src/app/auth/auth-bootstrap.test.ts`; these steps are the human confirmation in a real browser.

- [ ] **The public calendar renders with site data blocked.** In Chrome, open the site, then in the
      address-bar site settings (padlock → *Site settings* → *Cookies and site data*) choose **Block**
      for this origin, or use *Settings → Privacy → Third-party cookies → Block all cookies* while the
      tab is open. Hard-reload the app. The Event calendar renders normally — no blank/white page, no
      "Gones cannot start" alert.
- [ ] **The degradation is logged, never silent.** With site data still blocked, open DevTools →
      *Console* on that reload. Exactly one line reads
      `{"level":"error","boundary":"auth.bootstrap","context":{"degraded":"anonymous"},"message":"authCoordinationUnavailable"}`.
      An empty console here means the failure went silent and is a defect.
- [ ] **The other public surfaces work too.** Still with site data blocked, click through to an Event
      detail page and to the League Archive (Seasons → a Season → its Tournaments). Each page loads its
      content; navigation back and forward keeps working.
- [ ] **Auth-gated surfaces read as signed-out, not broken.** Still blocked, open the header account
      menu and navigate to a signed-in-only route (Settings / My registrations). You are treated as a
      visitor — you get the sign-in prompt or the login redirect, not a blank page and not a spinner
      that never ends.
- [ ] **Signing in with site data blocked fails cleanly.** Still blocked, submit the login form with
      valid credentials. It reports a failure in the UI and the app stays usable — the page must not go
      blank and must not need a manual reload to recover.
- [ ] **Normal browsing is untouched.** Re-allow cookies and site data for the origin, hard-reload, and
      sign in. The session restores across a reload exactly as before, and the console shows **no**
      `boundary":"auth.bootstrap"` line on a normal start.

## T9 flush-debounced-intents

Frontend-only fix in the Live runner: `ngOnDestroy`
(`src/app/features/live-tournaments/live-tournament-runner.component.ts`) used to `clearTimeout` every
debounced intent and drop both intent maps, so an edit made within the 400 ms debounce window was
applied optimistically to the on-screen document but never sent to the store. Destroy now calls
`void this.flushIntents()` — the same one-liner `saveDraft()` already used — which promotes each
pending debounced intent to the queue and lets the pump drain it; already-queued intents are no longer
discarded either. Automated coverage is
`src/app/features/live-tournaments/live-tournament-runner-destroy-flush.test.ts`; these steps are the
human confirmation in a real browser. Type the value and leave **immediately** (well under half a
second) in every step below — waiting for the debounce to fire tests the old path, not this fix.

- [ ] **A score typed just before leaving is kept (server mode).** Signed in as an Organizer with power
      user mode on, open a Live tournament that is in an active round. Type a score into a match, then
      *within the same second* click *Back to running tournaments*. Re-open the same tournament: the
      score you typed is still there. Hard-reload the page and confirm it survives the reload too — that
      proves it reached the server, not just the local view.
- [ ] **The same holds in the browser-local store.** Repeat the step above signed out (browser-local
      Live mode, the tournament shows the local-mode notice). Type a score, navigate straight back,
      re-open, then hard-reload. The score persists.
- [ ] **A player edit just before leaving is kept.** In the same runner, change a player's name (or one
      of their initial win/draw/loss values) and navigate away immediately. Re-open and hard-reload —
      the edited value is stored, not reverted to the old one.
- [ ] **A settings edit just before leaving is kept.** Change the tournament name, the Swiss round
      count, or the paid-tracking toggle and leave immediately. Re-open and hard-reload — the setting
      stuck.
- [ ] **Browser back/forward counts as leaving.** Repeat the score step but leave with the browser's
      **Back** button instead of the in-app button. Same result: the score is stored.
- [ ] **Leaving with nothing pending is silent.** Open a Live tournament, touch nothing, and navigate
      away. No error banner appears, and in DevTools → *Network* no `PATCH`/score request is issued by
      the runner on the way out (server mode). Nothing must be written just because the page closed.
- [ ] **Leaving while offline does not error or queue.** In server mode, open a Live tournament, go
      offline (DevTools → *Network* → *Offline*), type a score, and navigate away immediately. Come back
      online and re-open the tournament: the app shows no stuck spinner and no phantom write appears
      later — offline writes are refused up front, never replayed after the fact.
- [ ] **Leaving and coming straight back is not broken by the flush.** Type a score, navigate away, then
      immediately re-open the *same* tournament. The re-opened page shows the score and behaves
      normally. If it instead shows the stale-document message ("the tournament was modified elsewhere"
      / *Document périmé*), reload once — it must recover to the correct score rather than staying stuck
      or losing the edit.
- [ ] **Tab close is still not covered — confirm the known gap.** Type a score and close the browser tab
      outright (no navigation). Re-open the tournament: the score may be **lost**. This is expected and
      out of scope for this change; note it if it bothers you, but it is not a regression.

## T10 codify-live-tiebreak

Documentation-and-tests only — **zero behavior change**. The Live standings comparator
(`compareLiveStandingRows` in `src/app/domain/live-tournament.ts`, `LiveRules.CompareStandingRows` in
`backend/src/Gones.Domain/Live/LiveRules.cs`) has always carried one tiebreak the Archive comparator
(`compareRankingRows` in `src/app/domain/results.ts`, `LeagueRules.CompareRankingRows`) does not: more
**Match Wins** ranks higher, applied after Opponents' Game Win Percentage and before Player Name.
Because Finalize copies the validated Live Rounds verbatim into an Archive Tournament, the same Rounds
can legitimately rank differently on the Live standings page and on the archived Tournament Result.
That divergence is now written down in `docs/CONTEXT.md` and pinned by one cross-surface test per
language. No comparator logic was touched — the only edits to the two comparator files are single
comment lines. These steps confirm the documentation matches the shipped behavior.

- [ ] **The ranking contract states the Live exception.** Open `docs/CONTEXT.md` and find the bullet
      beginning "Ties in a **Tournament Result** are broken by…". The bullet immediately after it
      describes the Live Tournament standings' extra Match Wins tiebreak and says the divergence is
      intentional. Both bullets read as one coherent contract, not as a contradiction.
- [ ] **The domain Q&A carries the matching entry.** Still in `docs/CONTEXT.md`, find the Q&A exchange
      "If two Player Names have equal **Tournament Points**, what decides the order?". The Q&A directly
      after it asks "Do Live Tournament standings use the same tiebreak chain?" and answers that Live
      inserts Match Wins between Opponents' Game Win Percentage and Player Name. The wording agrees with
      the bullet from the previous step.
- [ ] **The comments in the code point at the documentation.** Open `src/app/domain/live-tournament.ts`
      at `compareLiveStandingRows` and `backend/src/Gones.Domain/Live/LiveRules.cs` at
      `CompareStandingRows`. Each has a one-line comment above it naming the divergence and pointing at
      `docs/CONTEXT.md` and at its pin test. The comparator bodies themselves are unchanged — the extra
      match-wins key was already there.
- [ ] **Both pin tests run and pass.** Run `npm run test -- live-tournament` and confirm the test named
      *"breaks live ties by match wins where the finalized archive falls through to player name (pinned
      divergence)"* is listed and green. Then run
      `dotnet test backend/Gones.sln --configuration Release --filter LiveArchiveTiebreakTests` and
      confirm `Live_match_wins_tiebreak_diverges_from_archive_ranking_on_finalize` passes.
- [ ] **The documented divergence is real in the browser (optional, slower).** Run a Live Swiss
      tournament to the end, validating every Round, and note the exact order of the standings table.
      Finalize it, then open the resulting Tournament in the Archive and compare its Ranking Table to
      what you noted. Rows that differ on Points or on any of the four shared tiebreakers must appear in
      the same order on both pages. Only a pair tied on all four shared keys but differing on Match Wins
      may swap — and if it does, the Live page must be the one that puts the player with more Match Wins
      first. Any other reordering is a real bug and must be reported.
- [ ] **Nothing else moved.** Browse the Live standings page and an archived Tournament Result page for
      an existing tournament you already know. The ranking numbers, tiebreaker columns and row order are
      exactly what they were before this change — this slice added documentation and tests only.

## T11 idempotency-expiry-sweep

Every idempotency writer already stamped `expires_at = now + 24h`, but no reader looked at it: a key
replayed a month later still returned the stored response, and nothing ever deleted the rows. This
slice enforces the window at the five idempotent surfaces (event registration/unregistration, event
lifecycle, event publication, archive tournament commands, live commands) and adds a worker sweep that
batch-deletes expired `idempotency_records` and `consumed_event_preview_tickets` (500 per table per
pass, first pass at worker startup, then every 24h; 1h retry after a failure). No schema change, no new
migration, no new environment variable.

Start from a stack running this branch (`npm run dev -- --detached`, which enables auth). Rebuild the
images first — `docker compose build api worker` — a stale worker image never sweeps. Then
`npm run dev:accounts` to seed `admin@gones.test` (Admin) and `test@gones.test` (User), password
`Gones-dev-pass-123!`. Get a token with:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:5080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@gones.test","password":"Gones-dev-pass-123!","deviceLabel":"manual"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
```

**Never run `docker compose down` while working through this section** — it destroys the local Postgres
volume and with it every row these steps are about. Use `docker compose stop` / `start` / `restart`.

- [ ] **A live key still replays — the control.** `curl -si -X POST http://127.0.0.1:5080/api/archive/tournaments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Idempotency-Key: manuel-vivant' -d '{"name":"Manuel vivant","tournamentDate":"2026-08-28"}'` returns `201`. Send the identical request again: `201` with the **same** `id`. Send it a third time with a different body (`"name":"Autre"`) and the same key: `409` with `"code":"idempotency_conflict"`. This is unchanged behavior and must still hold.
- [ ] **An expired key re-executes instead of replaying.** Create one with a fresh key: `curl -si -X POST http://127.0.0.1:5080/api/archive/tournaments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Idempotency-Key: manuel-expire' -d '{"name":"Manuel expire","tournamentDate":"2026-08-28"}'` → `201`, note the `id`. Force the stored row past its window: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "update idempotency_records set expires_at = now() - interval '1 hour' where key = 'manuel-expire';"` → prints `UPDATE 1`. Repeat the identical create with the same key. It returns `201` with a **different** `id`.
- [ ] **The re-execution left exactly one record, with a fresh window.** `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*), min(expires_at) > now() from idempotency_records where key = 'manuel-expire';"` prints `1|t` — the expired row was deleted and replaced, the unique `(scope, key)` index was never violated. `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*) from archive_tournaments where name = 'Manuel expire';"` prints `2`: both commands really ran.
- [ ] **The worker sweeps at startup and says so.** `docker compose restart worker`, wait a few seconds, then `docker compose logs worker | grep idempotency`. A line reading `Event=idempotency.records.swept; Count=N` appears (event id 7009). `N` is the number of expired rows it found — `0` is a valid result on a clean database.
- [ ] **The sweep deletes expired rows of both tables and keeps live ones.** Seed one expired and one live preview ticket, and expire one idempotency record: `docker compose exec -T postgres psql -U gones_migration -d gones -c "insert into consumed_event_preview_tickets (ticket_hash, expires_at) values (repeat('a',64), now() - interval '1 hour'), (repeat('b',64), now() + interval '1 hour');" -c "update idempotency_records set expires_at = now() - interval '1 hour' where key = 'manuel-vivant';"`. Then `docker compose restart worker` and wait for the `idempotency.records.swept` line. Now `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select (select count(*) from consumed_event_preview_tickets where ticket_hash = repeat('a',64)), (select count(*) from consumed_event_preview_tickets where ticket_hash = repeat('b',64)), (select count(*) from idempotency_records where key = 'manuel-vivant'), (select count(*) from idempotency_records where key = 'manuel-expire');"` prints `0|1|0|1`: both expired rows gone, both live rows untouched.
- [ ] **Sweeping a consumed preview ticket cannot reopen a replay.** A consumed ticket row expires at the ticket's own expiry (10 minutes after issue), so by the time the sweep can delete it the ticket itself is already refused. Confirm the refusal still fires *inside* the window: publish a tournament through the preview flow (`POST /api/events/preview`, then `POST /api/events` with the returned ticket), then immediately re-send the publish with that same ticket and a **different** idempotency key. It must be refused with `409` and `"code":"preview_ticket_replayed"`, not accepted.
- [ ] **Migration-import records are not swept.** Import a v5 bundle (`/archive` → import, or `npm run migration:smoke`), then `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*), min(expires_at) > now() + interval '90 years' from idempotency_records where scope like 'migration-import%';"`. The count is at least `1` and the second column is `t` — those rows are stamped 100 years out on purpose and must survive every sweep. Re-run `docker compose restart worker` and re-check: the count is unchanged.
- [ ] **The worker keeps doing its other work.** After the sweeps above, `docker compose logs worker | tail -30` still shows `worker.heartbeat` lines continuing, and `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select last_seen_at > now() - interval '2 minutes' from worker_heartbeats;"` prints `t`. Notifications, reminders and the tournament scheduler are unaffected.
- [ ] **A sweep failure is logged and retried, not fatal (optional).** With the stack up, `docker compose stop postgres`, wait ~30 seconds, then `docker compose start postgres`. `docker compose logs worker | grep -E 'idempotency.sweep_failed|worker.poll.failed'` shows an error line naming the exception type, and after Postgres is back the worker resumes heartbeating and eventually logs `idempotency.records.swept` again. The worker process must never exit. Do **not** use `docker compose down` for this step.
- [ ] **The other four idempotent surfaces behave the same way (spot check one).** Register for an event with an `Idempotency-Key`, expire that row (`update idempotency_records set expires_at = now() - interval '1 hour' where scope like 'tournament-registration:%';`), and replay the same registration request. It must re-execute rather than return the stored response — for an already-registered user that means the normal already-registered answer, never a stale replay of the first success.

## T12 agent-md-drift

Doc + gate slice: `AGENT.md` no longer names dead paths or a dead browser store, its "four newest
ADRs" paragraph is derived-and-gated instead of hardcoded, and product feedback points at the live
root `feedback.md`. No runtime code changed — no server, no Docker stack needed for these steps.

- [ ] **Every backend path AGENT.md names still exists.** Run `grep -o 'src/app/backend/[a-z.-]*\.ts' AGENT.md | sort -u | xargs ls`. Every listed path prints; nothing reports `No such file or directory`. In particular `local-league-archive-backend.service.ts` (deleted in `4e3eafe`) appears nowhere: `grep -c local-league-archive AGENT.md` prints `0`.
- [ ] **The browser-store paragraph names the live database.** Open `AGENT.md`, find the "Two exceptions (ADR 0021, ADR 0028)" paragraph. It reads `` `gones-archive-local` / `leagues` ``. Cross-check against the code: `grep -n "LOCAL_ARCHIVE_DB_NAME\|LOCAL_LEAGUE_STORE" src/app/backend/local-archive-backend.service.ts` shows `'gones-archive-local'` and `'leagues'`. The retired `gones-leagues` name must appear in AGENT.md nowhere: `grep -c 'gones-leagues' AGENT.md` prints `0` (the code still deletes that old database on sight — `src/app/backend/local-archive-backend.service.ts:60` — which is correct and unchanged).
- [ ] **AGENT.md defers the IndexedDB allowlist to the test instead of listing files.** The same paragraph points at `src/app/backend/server-authority-boundary.test.ts` (test `confines IndexedDB to the sanctioned local adapters`) and states no file list and no file count. Open that test and confirm the allowlist is really there and longer than what AGENT.md used to claim. Then confirm the deferral survives a change: temporarily add a 7th entry to that test's array, re-read AGENT.md — it is still accurate with no edit — and revert the test (`git checkout -- src/app/backend/server-authority-boundary.test.ts`).
- [ ] **The "four newest ADRs" paragraph matches the four highest-numbered files on disk.** `ls docs/adr/ | tail -4` prints `0047-…`, `0048-…`, `0049-…`, `0050-…`. AGENT.md's ADR paragraph names **0047**, **0048**, **0049**, **0050** and describes each one correctly (0047 rebuild without migration / amends 0020; 0048 archive catalogs in IndexedDB / amends 0039; 0049 per-scope Glicko-2 / amends 0040; 0050 retire the legacy archive surface / supersedes 0022). Spot-check one against its file, e.g. `head -8 docs/adr/0049-per-scope-player-ratings.md`.
- [ ] **The still-binding ADRs survived the rewrite.** The same paragraph still names **0038**, **0039** (with `24h`), **0040**, **0041** and **0044** as binding for today's code — an agent reading only AGENT.md must not conclude the TTL-cache or back-button rules were dropped.
- [ ] **The gate now catches a stale AGENT.md.** Run `npm run test -- ops/agent-rules` → 7 passed. Now simulate a new ADR landing without a doc update: `printf '# Temp\n\n## Status\n\nAccepted.\n' > docs/adr/0051-temp-manual-check.md`, re-run `npm run test -- ops/agent-rules` → it **fails** with `AGENT.md must mention ADR 0051`. Delete the temp file (`rm docs/adr/0051-temp-manual-check.md`) and re-run → 7 passed again. Before this change the same experiment stayed green, which is the bug being fixed.
- [ ] **Feedback readers land on the live file.** `AGENT.md` `.dev/` table row lists `bugs.md, ideas.md, decisions/` and points product feedback at root `feedback.md`; the "Rules for agents" bullet says the same and forbids moving/renaming/regenerating it. Follow the pointer: `wc -l feedback.md` prints `39` (the real feedback), while `wc -l .dev/feedback.md` prints `3` (the stub). `grep -n 'feedback' AGENT.md` shows no line presenting `.dev/feedback.md` as the place to write feedback.
- [ ] **The user-authored feedback file was not touched by this commit.** `git show --stat HEAD` lists only `AGENT.md` and `ops/agent-rules.test.ts`; `git log --oneline -- feedback.md | head -3` shows no new commit on top of the pre-existing history.

## T13 retire-pages-deploy

Deletion-only slice: the GitHub Pages deploy pipeline is retired — workflow, prepare script, runbook,
the `build:pages` npm script and every repo reference to them are gone, and ADR 0013 is marked
superseded. No runtime code changed: no server, no Docker stack and no `docker compose` command is
needed for any step below.

- [ ] **The three pipeline files are gone from the working tree.** Run `ls .github/workflows/deploy-pages.yml scripts/prepare-github-pages.mjs docs/online-website-runbook.md`. All three report `No such file or directory`. Confirm they left history intact rather than never existing: `git log --oneline -1 -- scripts/prepare-github-pages.mjs` still prints the retiring commit, and `git show HEAD~1:scripts/prepare-github-pages.mjs | head -3` still prints the old file.
- [ ] **`.github/workflows/` holds exactly the two surviving workflows.** `ls -1 .github/workflows/` prints `release-images.yml` and `static.yml` and nothing else. Open `static.yml` and confirm it is the CI workflow (lint/typecheck/test), not a Pages deploy — it must still be there, untouched by this commit.
- [ ] **`npm run build:pages` no longer exists.** Run `npm run build:pages`. npm refuses with `Missing script: "build:pages"`. Then run `npm run build` — it still completes with `Application bundle generation complete.` and writes `dist/gones/browser/`. The production build is unaffected by the removal.
- [ ] **No live reference to the retired pipeline survives.** Run `grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.tmp --exclude-dir=artifacts --exclude-dir=graphify-out -e 'deploy-pages' -e 'prepare-github-pages' -e 'build:pages' -e 'online-website-runbook' .`. The only hits are two lines in `docs/adr/0013-host-angular-spa-on-github-pages.md` — its new `Status: superseded` line and its original body sentence. Both are the ADR's historical record of what was retired; an ADR is an append-only decision log, so naming the dead workflow there is correct. Any hit in a script, workflow, `package.json` or a live doc would be a defect.
- [ ] **ADR 0013 is marked superseded in the repo's own ADR format.** `head -5 docs/adr/0013-host-angular-spa-on-github-pages.md` shows the title, a blank line, then a line starting `Status: superseded — …` that names `.github/workflows/deploy-pages.yml` and points at `DEPLOYMENT.md` as the supported host. Compare the shape against a sibling: `head -3 docs/adr/0003-plain-data-builders-and-jsdoc-types.md` uses the same `Status: superseded …` line in the same position. The ADR's original body text below must be unchanged — history is not rewritten, only annotated.
- [ ] **The README build-gates table lost only the Pages row.** Open `README.md`, find the "Build and release gates" table. The `npm run build` row and the `npm run e2e:ci` row are now adjacent, and no `npm run build:pages` row remains. Every other row (`acceptance:matrix`, `release:preflight`, `release:candidate`, `release:rehearsal`, …) is still present and unedited.
- [ ] **The glossary lost the runbook row and no other row.** Open `docs/GLOSSARY.md`. The table now ends on the `cypress` row; the `| runbook | Operator procedures for the online deployment | docs/online-website-runbook.md |` row is gone. Confirm no other glossary term disappeared: `git diff HEAD~1 -- docs/GLOSSARY.md` shows exactly one deleted line and zero added lines. `docs/OPERATIONS.md` — a different, still-live operator runbook — is untouched and still referenced from `README.md`.
- [ ] **No Pages deploy fires on the next push to `main`.** After this commit is pushed, open the repository's Actions tab in a browser. The run list for the new commit shows the CI and release workflows only; no run titled "Deploy Angular app to GitHub Pages" appears, and no `github-pages` deployment is created. Read-only observation — do not re-trigger or cancel anything.
- [ ] **Repo-external follow-up, must be done by a human in the GitHub UI: turn the Pages site off.** This commit removes the pipeline but cannot unpublish what was already deployed, so the last (broken) artifact keeps being served until someone changes the setting. In the repository, go to Settings → Pages and set the source to **None** to take the site down. This is deliberately outside the commit: the ticket's policy is zero GitHub API interaction. Until it is done, `https://arongomu.github.io/gones/` still serves the stale bundle whose baked API origin points at the visitor's own localhost, so every server read on it fails.
- [ ] **Known residual — the README capability bullet still advertises Pages.** `README.md:29` still reads `- GitHub Pages static hosting through GitHub Actions`. It names no deleted file, so it is not a dangling reference, but it is now a stale claim; it sat outside this ticket's locked edit set and was deliberately not touched. Confirm it is the only such stale claim outside fenced files: `grep -rn 'GitHub Pages' README.md DEPLOYMENT.md docs/ --exclude-dir=adr` returns that one README line plus `DEPLOYMENT.md:47`, which correctly describes static hosts as a *possible* alternative rather than the active host.

## T14 runtime-contract-legal-values

Doc-only slice: `docs/RUNTIME_CONTRACT.md` now states `server` as the single legal data-authority value and cites ADR 0020. Nothing executable changed, so there is no app flow to click through — the steps below prove the document now matches the three implementations that already enforce it. No running stack, no container and no browser are needed; run everything from the repository root.

- [ ] **The contract presents `server` as the only legal value.** Open `docs/RUNTIME_CONTRACT.md` and read the "Frontend data authority" section. The paragraph under the build-arg table opens with `` `server` is the only legal value. ``, and the "Runtime injection (C44)" table row reads ``| `GONES_DATA_MODE` | `server` — the only legal value |``. No line anywhere in the section offers `legacy-browser` as something an operator may configure. An operator provisioning a host from this section alone must end up with a configuration that actually boots.
- [ ] **`legacy-browser` survives exactly once, as retired and refused.** Run `grep -c "legacy-browser" docs/RUNTIME_CONTRACT.md` → prints `1`. Run `grep -n "legacy-browser" docs/RUNTIME_CONTRACT.md` → the single hit is line 40 and contains both `retired` and `refused`, and the same sentence names the error code `dataModeUnknown`. Run `grep -n 'or `legacy-browser`' docs/RUNTIME_CONTRACT.md; echo $?` → no output and `1`. That phrasing was the old runtime-value table row; it must not come back.
- [ ] **The ADR citation points at the accepted decision.** `grep -n "ADR 0020" docs/RUNTIME_CONTRACT.md` prints two lines: the declaration paragraph (`ADR 0019, narrowed to server-only by ADR 0020`) and the retired-mode sentence. ADR 0019 is still named as the origin of the "declare, never infer" rule — that is deliberate history, not a stale reference. Confirm 0020 is the accepted decision that supersedes it: `head -6 docs/adr/0020-retire-the-legacy-browser-data-authority.md` shows `Accepted. Supersedes ADR 0019 …`.
- [ ] **The doc's "all three layers" claim is true — build-time checker.** `grep -n "DATA_MODES\|dataModeUnknown" scripts/check-frontend-data-authority.mjs` shows `const DATA_MODES = ['server'];` and the failure path returning `'dataModeUnknown'`. The doc names this file by path, so also confirm the path still exists after the recent pipeline retirements: `ls scripts/check-frontend-data-authority.mjs`.
- [ ] **… browser resolver.** `grep -n "DATA_MODES\|dataModeUnknown" src/app/config/data-authority.ts` shows `export const DATA_MODES = ['server'] as const;` and `dataModeUnknown` as a member of `DataAuthorityErrorCode`.
- [ ] **… container-start gate, exercised for real.** Run `GONES_DATA_MODE=legacy-browser GONES_API_BASE_URL=https://api.example.com sh deploy/nginx/gones-data-authority.sh; echo "exit=$?"` → prints `dataModeUnknown` then `exit=2`. Run it again with `GONES_DATA_MODE=server` → prints nothing but `exit=0`. This is the operator-facing consequence the document describes: a host that provisions the retired value exits before nginx serves a byte.
- [ ] **The six runtime key names survived the rewrite.** Run `npx vitest run ops/host-contract.test.ts` → `Test Files 1 passed`, `Tests 19 passed`. That suite asserts every vendor-neutral runtime key name still appears verbatim in the contract, which is the gate that would catch an edit that dropped a key while rewording a table. Spot-check by eye too: `GONES_FRONTEND_DATA_MODE`, `GONES_FRONTEND_API_BASE_URL`, `GONES_DATA_MODE`, `GONES_API_BASE_URL`, `GONES_AUTH_V1`, `GONES_ADMIN_V1` are all still in the document.
- [ ] **The commit is doc-only.** `git show --stat 3c0dc65` lists two files: `docs/RUNTIME_CONTRACT.md` with 11 insertions and 11 deletions, and `artifacts/manual_test_checklist.md` carrying this very section. Narrow it to the contract alone with `git show --stat 3c0dc65 -- docs/RUNTIME_CONTRACT.md`. No implementation file, no ADR, no `DEPLOYMENT.md`, no test file appears in either commit of this slice. If any implementation layer changed, this slice overstepped.
- [ ] **The stale "frozen static deployment" wording is gone and nothing replaced it with a dead reference.** `grep -n -i "frozen static\|github pages\|build:pages\|deploy-pages\|online-website-runbook" docs/RUNTIME_CONTRACT.md` returns no output. The retired Pages pipeline was deleted in an earlier commit of this batch; this edit must not resurrect a reference to it.
- [ ] **Known residual — the same sentence now lives in two documents.** `grep -n "only legal value" DEPLOYMENT.md docs/RUNTIME_CONTRACT.md` returns two hits in each file. `DEPLOYMENT.md` already said it before this ticket; the duplication is intentional (operator runbook vs. vendor-neutral host contract, different audiences) and `DEPLOYMENT.md` was outside this ticket's locked edit set. No action needed — noted so a future reader does not treat it as drift.

## T15 compose-documented-vars

Config-only slice: the three compose stacks now source the frontend service's runtime keys and flag
build arguments from the variable names `.env.example` documents, instead of a different family that
silently shadowed them. No application code changed, so there is no new screen to inspect — the steps
below prove the render, the container-start effect and the one behaviour an operator will notice. Run
everything from the repository root. **Never run `docker compose down --volumes` while checking this**
— it destroys the local Postgres volume; stop individual containers instead.

- [ ] **The documented runtime name reaches the release frontend.** Run `GONES_API_BASE_URL=https://operator.example docker compose --profile release config frontend-release`. The `frontend-release` service's `environment:` block shows `GONES_API_BASE_URL: https://operator.example`. Before this commit the same command printed `GONES_API_BASE_URL: http://127.0.0.1:5080` and swallowed the operator's value without a word — that silent shadowing is the finding being fixed.
- [ ] **All four runtime keys pass through together.** Run `GONES_DATA_MODE=server GONES_API_BASE_URL=https://operator.example GONES_AUTH_V1=true GONES_ADMIN_V1=true docker compose --profile release config frontend-release`. The `frontend-release` environment block reads exactly `GONES_ADMIN_V1: "true"`, `GONES_API_BASE_URL: https://operator.example`, `GONES_AUTH_V1: "true"`, `GONES_DATA_MODE: server`. Those are the four names `deploy/nginx/gones-data-authority.sh` reads at container start (lines 15-18), so what compose renders is what the container consumes.
- [ ] **The documented build-argument names reach both frontend services.** Run `GONES_FRONTEND_AUTH_V1=true GONES_FRONTEND_ADMIN_V1=true docker compose --profile release config frontend-development frontend-release | grep GONES_FRONTEND_`. Two groups of four lines appear — one per service — each containing `GONES_FRONTEND_AUTH_V1: "true"` and `GONES_FRONTEND_ADMIN_V1: "true"`. Before this commit those two arguments were fed from `GONES_FEATURES__AUTH_V1` / `GONES_FEATURES__ADMIN_V1`, so setting the documented names did nothing.
- [ ] **The rehearsal stacks honour an operator origin too.** Run `GONES_API_BASE_URL=https://operator.example docker compose -f compose.release-test.yaml config frontend`, then `GONES_IMAGE_MIGRATOR=sha:x GONES_IMAGE_API=sha:x GONES_IMAGE_WORKER=sha:x GONES_IMAGE_FRONTEND=sha:x GONES_IMAGE_BACKUP=sha:x GONES_API_BASE_URL=https://operator.example docker compose -f compose.release-test.yaml -f compose.release-candidate.yaml config frontend`. Both print `GONES_API_BASE_URL: https://operator.example`; the release-candidate overlay held four hardcoded literals before this commit. The release-test **build arguments** must still be hardcoded: `sed -n '193,197p' compose.release-test.yaml` shows literal `server`, `"true"`, `"true"` and `https://localhost:8443` with no `${…}` anywhere — deliberate, because building the artifact with a different default origin is what proves runtime injection during the rehearsal.
- [ ] **Nothing changes for an operator who sets nothing.** With no `.env` file in the repository root, run `docker compose --profile release --env-file /dev/null config frontend-release` → `GONES_DATA_MODE: server`, `GONES_API_BASE_URL: http://127.0.0.1:5080`, `GONES_AUTH_V1: "false"`, `GONES_ADMIN_V1: "false"`. Then `docker compose -f compose.release-test.yaml --env-file /dev/null config frontend` → `https://localhost:8443` with both flags `"true"`. These are byte-identical to the pre-commit renders; compare the sources with `git show HEAD~1:compose.yaml | sed -n '155,170p'` (valid while this commit is `HEAD`) and confirm only the variable *names* moved, never the defaults.
- [ ] **THE ONE BEHAVIOUR CHANGE — copying the documented file now turns the frontend's auth and admin routes ON.** `.env.example` ships `GONES_FRONTEND_AUTH_V1=true`, `GONES_FRONTEND_ADMIN_V1=true`, `GONES_AUTH_V1=true` and `GONES_ADMIN_V1=true` (lines 4-16), and `docs/OPERATIONS.md` §1 tells the operator to `cp .env.example .env`. Do exactly that, then run `docker compose --profile release config frontend-release`: the frontend now renders `GONES_AUTH_V1: "true"` and `GONES_ADMIN_V1: "true"`, where before this commit those four keys were inert and the container came up with sign-in and admin resolving to the not-found component. This is the intended outcome — the documented names win. An operator who wants those routes off must now set them to `false` in their own `.env` rather than rely on being ignored. When finished, delete the scratch `.env` you created (it is git-ignored, but it changes every later compose render on this machine).
- [ ] **`GONES_FEATURES__*` no longer leaks into the frontend.** Run `GONES_FEATURES__AUTH_V1=true GONES_FEATURES__ADMIN_V1=true docker compose --profile release --env-file /dev/null config frontend-release`. In the same rendered output, the `api` service still carries `GONES_FEATURES__AUTH_V1: "true"` / `GONES_FEATURES__ADMIN_V1: "true"` while the `frontend-release` service reads `GONES_AUTH_V1: "false"` / `GONES_ADMIN_V1: "false"`. The backend flag names keep working for the backend; they simply stopped doubling as frontend flags. Confirm the backend wiring survived: `grep -n 'GONES_FEATURES__' compose.yaml` still shows the two `api` lines at 74-75.
- [ ] **The container-start gate really reads these names.** Run `GONES_DATA_MODE=server GONES_API_BASE_URL=https://operator.example GONES_ADMIN_V1=true sh deploy/nginx/gones-data-authority.sh; echo "exit=$?"` → prints `serverModeAdminRequiresAuth` then `exit=2`, because admin without auth is refused. Add `GONES_AUTH_V1=true` to the same command → prints nothing and `exit=0`. Compose now assigns exactly these variable names, so an incoherent operator `.env` fails loudly at container start instead of quietly serving an app with the wrong capabilities.
- [ ] **Live container check (optional; needs Docker and a few minutes).** Run `GONES_API_BASE_URL=http://127.0.0.1:5080 GONES_AUTH_V1=true GONES_ADMIN_V1=true docker compose --profile release up -d --wait frontend-release` — this also starts `postgres`, `migrator` and `api`, because `frontend-release` waits on a healthy API. Then `curl -sS http://127.0.0.1:8081/runtime-config.json` prints `{"dataMode":"server","apiBaseUrl":"http://127.0.0.1:5080","features":{"authV1":true,"adminV1":true}}` (shape from `deploy/nginx/gones-runtime-entrypoint.sh:38-40`), and `docker compose --profile release logs frontend-release | tail -1` ends with `gones: serving dataMode=server apiBaseUrl='http://127.0.0.1:5080' authV1=true adminV1=true`. Browsing `http://127.0.0.1:8081/sign-in` shows the sign-in page rather than not-found. Tear down with `docker compose --profile release stop frontend-release` — **not** `docker compose down --volumes`. This step was not executed by the implementer; the ticket's automated evidence stops at the rendered config.
- [ ] **Known residual — `npm run e2e:ci` needs the new names exported before it can pass.** `scripts/full-stack-ci.mjs:7-15` exports `GONES_FEATURES__AUTH_V1='true'` / `GONES_FEATURES__ADMIN_V1='true'` plus `GONES_FRONTEND_DATA_MODE` / `GONES_FRONTEND_API_BASE_URL`, but never `GONES_FRONTEND_AUTH_V1`, `GONES_FRONTEND_ADMIN_V1`, `GONES_AUTH_V1` or `GONES_ADMIN_V1`, and it brings the stack up with `--profile release`. Now that the frontend flags no longer follow `GONES_FEATURES__*`, that stack serves a frontend with auth and admin off, so the auth/admin specs (`auth-profile`, `auth-route-guards`, `auth-session-persistence`, `admin-orgs`, `admin-notification-delivery`, `power-user-gating`, `organizer-*`) are expected to fail on the not-found component. Confirm the gap without running anything: `grep -n 'GONES_FRONTEND_AUTH_V1\|GONES_AUTH_V1' scripts/full-stack-ci.mjs` returns no output. That script sat outside this ticket's locked edit set; adding the four exports is a one-line follow-up that needs its own ticket, and it should land before anyone relies on the plan's closing `npm run e2e:ci` run.
- [ ] **The commit is compose-only.** `git show --stat HEAD` lists exactly four files: `compose.yaml` (16 changed lines), `compose.release-test.yaml` (8), `compose.release-candidate.yaml` (8) and `artifacts/manual_test_checklist.md` carrying this section. No `.env.example`, no `docs/OPERATIONS.md`, no `DEPLOYMENT.md`, no `deploy/nginx/gones-data-authority.sh`, no Dockerfile and no test file may appear. Confirm no new `GONES_FEATURES__` reference was introduced anywhere in the diff: `git show HEAD -- compose.yaml | grep '^+.*GONES_FEATURES__'` returns no output (the removed `-` lines are the point of the commit).

## T16 remove-dead-repair-key

Doc-only slice: `.env.example` stopped documenting `GONES_LEAGUES__BACKFILL_CATALOG_COUNTS_ON_STARTUP`,
a key whose hosted service (`LeagueArchiveCatalogCountsBackfill`) was deleted in `4e3eafe` and which no
backend code has read since, and ADR 0042 now declares itself superseded and points at the write-time
repair that actually exists. No `.cs`, no `.ts`, no compose, no deploy file changed, so there is no new
screen and no new behaviour — the steps below prove an **absence**, which is exactly the thing a green
test suite cannot prove on its own. Run everything from the repository root.

- [ ] **The dead key is gone from the documented surface, by pure deletion.** Run `grep -n "BACKFILL_CATALOG_COUNTS" .env.example; echo "exit=$?"` → no output and `exit=1`. Then `git show --stat HEAD -- .env.example` → `4 ----`, i.e. four deletions and zero insertions. A diff with any `+` line in `.env.example` means the slice overstepped: this change removes documentation, it does not reword it.
- [ ] **The surrounding blocks still read correctly — exactly one blank line, no double gap.** Run `grep -n -A2 "EXPOSE_DECAYED_RATING" .env.example`. The three printed lines are `GONES_PLAYER_STATISTICS__EXPOSE_DECAYED_RATING=false`, one empty line, then `# Local auth smoke only. Keep auth disabled unless exercising hidden API.` If you see two blank lines, the deletion took the wrong adjacent line.
- [ ] **Removing it is provably a no-op — nothing reads the key or its configuration section.** Run `git grep -n "Gones:Leagues"` → the only hits are `docs/adr/0042-slim-league-archive-catalog.md` (lines 8 and 50) and `docs/league-archive-catalog-summary.html:127`, both prose/diagram, no code. Then `grep -rn 'GetSection("Leagues")\|Configuration\["Leagues' backend/src; echo "exit=$?"` → no output and `exit=1`. And `git grep -n "GONES_LEAGUES__" -- ':!artifacts/'; echo "exit=$?"` → no output and `exit=1`. An operator who still has this key in their live `.env` loses nothing, because nothing ever consumed it.
- [ ] **The key is absent from every deploy and CI surface too, not just `.env.example`.** Run `git grep -rn "BACKFILL_CATALOG\|Gones:Leagues" -- .github scripts deploy '*.yaml' '*.yml' '*Dockerfile*' '*.json'; echo "exit=$?"` → no output and `exit=1`. This is the check that would catch a compose file or workflow quietly passing the key through after the documentation stopped mentioning it.
- [ ] **ADR 0042's Status now says superseded and names the real replacement.** Run `sed -n '1,16p' docs/adr/0042-slim-league-archive-catalog.md`. Line 5 begins `Superseded by [ADR 0045](./0045-three-tier-archive.md) and`; the paragraph names `LeagueArchiveCatalogCountsBackfill`, `Gones:Leagues:BackfillCatalogCountsOnStartup`, `ArchiveLeagueSeason.RefreshCatalogCounts`, `CountsVersion` and `ArchiveCatalogCounts.Version`, and closes with `No startup or operator-facing repair path exists.` That last sentence is the point of the edit — a reader must not leave this ADR believing a startup repair still runs.
- [ ] **Both superseding links resolve.** Run `ls docs/adr/0045-three-tier-archive.md docs/adr/0050-retire-the-legacy-archive-surface.md` → both print, no `No such file`. A superseded banner pointing at a missing ADR is worse than no banner.
- [ ] **The original Status text survived verbatim under `Originally:` — history was annotated, not rewritten.** Run `git show HEAD~1:docs/adr/0042-slim-league-archive-catalog.md | sed -n '5,8p'` and compare with `sed -n '13,16p' docs/adr/0042-slim-league-archive-catalog.md`. The four lines are identical apart from the `Originally: ` prefix on the first. An ADR records what was decided at the time; deleting that record would misstate the history this repo keeps deliberately.
- [ ] **Nothing below the Status section moved.** Run `git show --stat HEAD -- docs/adr/0042-slim-league-archive-catalog.md` → `10 +++++++++-` (9 insertions, 1 deletion). Then `git show HEAD -- docs/adr/0042-slim-league-archive-catalog.md` → a single hunk headed `@@ -2,7 +2,15 @@`. The Context, Decision, Security note and Consequences sections must be untouched, including their now-historical description of the deleted backfill at line 49-50.
- [ ] **The write-time repair the new Status describes really is the one that exists.** Run `sed -n '108,126p' backend/src/Gones.Domain/Archive/ArchiveLeagueSeason.cs` → `RefreshCatalogCounts` returns early when the counts match **and** `CountsVersion == ArchiveCatalogCounts.Version`, otherwise restamps both. Then `git grep -n "season.RefreshCatalogCounts" -- backend/src` → exactly three write paths: `ArchiveTournamentCommandEndpoints.cs:405`, `LiveCommandEndpoints.cs:401`, `MigrationImportService.cs:151`. If any of those three disappears, the ADR's "on every Tournament write" claim stops being true and this Status needs revisiting.
- [ ] **No startup repair for archive counts remains — only the player-statistics one.** Run `grep -n "AddHostedService\|StartupRebuild" backend/src/Gones.Api/Program.cs` → one line, `128`, registering `PlayerStatisticsStartupRebuild`. That service rebuilds player statistics (ADR 0040), not archive counts. `.env.example` still documents its key, `GONES_PLAYER_STATISTICS__REBUILD_ON_STARTUP` — that one is live and must stay.
- [ ] **The retirement guard still forbids the deleted type coming back.** Run `sed -n '20,26p' backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs` → the forbidden-name list still contains `"LeagueArchiveCatalogCountsBackfill"`. Run `dotnet test backend/tests/Gones.ArchitectureTests --configuration Release` → `Passed! - Failed: 0, Passed: 20`. This slice must not have weakened that assertion; if the name were dropped from the list, re-adding the hosted service would stop failing CI.
- [ ] **Every surviving mention of the key is a record, never a live read.** Run `git grep -n "BACKFILL_CATALOG_COUNTS\|BackfillCatalogCountsOnStartup\|LeagueArchiveCatalogCountsBackfill"` and check each hit against this list — five places, all deliberate: (a) this file at line 768, the manual-test record of the 2026-08-20 T9 slice, describing what was tested when the service existed; (b) `docs/adr/0042-...:7-8`, the new superseded banner naming what was removed; (c) `docs/adr/0042-...:49-50`, the ADR's historical Decision text; (d) `docs/league-archive-catalog-summary.html:126-129`, a dated design diagram; (e) `backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs:23`, which names the type in order to keep it deleted. A sixth hit anywhere — especially in `backend/src`, a compose file or a deploy script — is a regression.
- [ ] **The commit is doc-only.** Run `git show --stat HEAD` → exactly three files: `.env.example`, `docs/adr/0042-slim-league-archive-catalog.md` and `artifacts/manual_test_checklist.md` carrying this very section. No `.cs`, no `.ts`, no compose file, no deploy script, no other ADR, no migration. If an implementation file appears, this slice overstepped a scope its ticket marked USER-LOCKED.
- [ ] **Known residual — `LeagueCatalogCounts` is now orphaned production code and this ticket could not touch it.** Run `git grep -n "LeagueCatalogCounts"` → the only hit under `backend/` is its own declaration at `backend/src/Gones.Domain/Leagues/LeagueCatalogCounts.cs:10`; every other hit is documentation. The class has had no caller since `4e3eafe` deleted the backfill, and its doc comment at line 8 still promises that "the startup backfill repairs exactly the rows stamped with an older version" — a repair that no longer exists. Deleting a `.cs` file was explicitly out of this ticket's scope, so it was left alone deliberately. It needs its own removal ticket; until then, treat that comment as stale.
- [ ] **Known residual — `docs/league-archive-catalog-summary.html` still draws the deleted hosted service.** Lines 126-129 render an SVG box labelled `LeagueArchiveCatalogCountsBackfill` / `IHostedService · Gones:Leagues:BackfillCatalogCountsOnStartup`. That file is a dated design record and was already ratified as leave-as-written earlier in this file (see the T19 `retire-legacy-surface` section, "some dated records still name the retired surface"), on the same reasoning that keeps ADR bodies intact. It is not a live configuration surface and no tooling reads it. Left untouched on purpose; note that the ticket's own step 3.2 grep expected this file to be clean, which it never could be without widening scope.

## T17 rate-limit-best-effort

Behaviour slice: the rate-limit rejection path used to `await` a durable audit write with no `try`/`catch`,
so a database failure during that write unwound out of `OnRejected` and the caller got a 500 instead of the
documented 429 — and the write fired on *every* rejected request on *every* partition, appending permanently
retained rows to a table that has no retention path by design. ADR 0017 already called that write
best-effort; the code now matches. Two changes: the write is swallow-and-logged, and only `/api/auth/**`
rejections still earn a row. Metrics (`OperationalMetrics.RecordAuthRejection`) still fire on every
rejection, on every partition. Run everything from the repository root.

- [ ] **The 429 contract survives a dead database — the point of the slice.** Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~RateLimitPolicyTests` → `Passed! - Failed: 0, Passed: 17`. The test that matters is `Rate_limit_rejection_still_returns_429_when_the_audit_write_fails`: it boots the auth surface against the unreachable DSN `Host=127.0.0.1;Port=1;…`, sets `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT=1`, POSTs `/api/auth/login` twice, and requires the second response to be `429` with problem `code` `rate_limited` and a `Retry-After` parsing to a positive integer. Before this commit that same test returned `InternalServerError` — check out `HEAD~1` into a scratch worktree and re-run it if you want to see the red for yourself.
- [ ] **See it live, not just in a test (optional; needs a terminal and ~2 minutes).** Start the API pointed at a dead database: `GONES_FEATURES__AUTH_V1=true GONES_AUTH_PROVIDER=Local GONES_AUTH_SIGNING_KEY=local-manual-check-signing-key GONES_DB_CONNECTION='Host=127.0.0.1;Port=1;Database=gones;Username=none;Password=none' GONES_ALLOWED_ORIGINS=https://app.example GONES_PUBLIC_APP_ORIGIN=https://app.example GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT=1 ASPNETCORE_URLS=http://127.0.0.1:5099 dotnet run --project backend/src/Gones.Api`. In a second terminal run this twice: `curl -si -X POST http://127.0.0.1:5099/api/auth/login -H 'content-type: application/json' -d '{"email":"limit@example.test","password":"irrelevant-password-1!"}' | head -12`. The second call must show `HTTP/1.1 429`, `content-type: application/problem+json`, a `retry-after:` header, and `"code":"rate_limited"` in the body. Stop the API with Ctrl-C — do **not** run `docker compose down --volumes`.
- [ ] **The swallow is not silent.** In the API terminal from the previous step, the second call must also print a warning line whose message is `Rate-limit audit write failed for operation login; rejection still returned`, logged under category `Gones.Api.Security.AuthRateLimiting`, with the underlying connection exception attached. A 429 with *no* such line means the write silently succeeded or was never attempted — re-check that `GONES_DB_CONNECTION` really points at a dead port. A silent swallow is the exact failure mode this step exists to catch.
- [ ] **Auth rejections against a *healthy* database still write their audit row.** Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~LocalIdentityApiTests` → `Failed: 0`. That suite contains the pre-existing assertion at `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs:242`, `Assert.True(await database.AuditRecords.AnyAsync(record => record.Action == "auth.login.rate_limited"))`. It was green before this commit and must still be green after: the slice narrows *which* partitions are audited, it does not stop auditing the auth surface.
- [ ] **A token-guessing flood on the review-link route still returns 429 and now appends no audit row.** Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~EventProposalDecisionTests` → `Failed: 0`. `Decision_is_rate_limited` fires 21 `GET /api/event-proposals/by-token/{token}` requests, each with a *different* guessed token, and its xUnit output prints two lines: `statuses -> 404,404,404,404,404,429,429,…` (the limiter still bites, keyed on the route pattern rather than the raw path, so each guess does not get its own budget) and `rate-limit audit actions -> ` with nothing after the arrow (zero rows). That empty second line is the observable this slice adds: a brute-force run against a public route can no longer append unbounded, permanently retained rows.
- [ ] **Non-auth rejections on the other partitions are equally row-free.** The four global-limiter partitions are covered by `RateLimitPolicyTests`: `Anonymous_reads_are_limited_per_client_with_429_and_retry_after` (`public-read`), `Authenticated_reads_outside_admin_are_limited_per_user_with_429_and_retry_after` (`authenticated-read`, added by T2), `Authenticated_writes_are_limited_per_user_and_do_not_leak_across_users` (`write`) and `Admin_surface_uses_its_own_bucket_separate_from_writes` (`admin`). All four still assert 429 and a positive `Retry-After`; none of them registers a `GonesDbContext`, which is exactly why they passed before the fix and still pass now. Confirm the routing decision directly with `Only_the_auth_surface_earns_a_rejection_audit`, which pins six paths: `/api/auth/login` and `/api/auth/refresh` → audited; `/api/_contract/public-read`, `/api/admin/x`, `/api/leagues` and `/health/live` → not.
- [ ] **The path guard is segment-aware, not a string prefix.** Run `grep -n 'ShouldAuditRejection' backend/src/Gones.Api/Security/AuthRateLimiting.cs` → the predicate reads `path.StartsWithSegments("/api/auth")`. `StartsWithSegments` matches only on a segment boundary, so a hypothetical `/api/authorizations` route would **not** be audited, whereas a naive `path.Value.StartsWith("/api/auth")` would have swept it in. If someone ever "simplifies" this to `StartsWith`, that is a regression, not a cleanup.
- [ ] **The metrics counter was deliberately left alone.** Run `grep -n 'RecordAuthRejection' backend/src/Gones.Api/Security/AuthRateLimiting.cs` → two call sites, both **outside** any `if`: one in the `options.OnRejected` lambda, one in `AuthAccountRateLimitFilter.InvokeAsync`. Every rejection on every partition still increments the counter; only the durable row is now conditional. Operational visibility into rate limiting is unchanged by this commit — if you can no longer see rejections in metrics, something other than this slice broke.
- [ ] **The commit is three product files and no more.** Run `git show --stat HEAD` → exactly four entries: `backend/src/Gones.Api/Security/AuthRateLimiting.cs`, `backend/tests/Gones.IntegrationTests/RateLimitPolicyTests.cs`, `backend/tests/Gones.IntegrationTests/EventProposalDecisionTests.cs`, and `artifacts/manual_test_checklist.md` carrying this section. No migration, no compose file, no frontend file, no ADR. In particular `docs/adr/0017-application-rate-limits-with-deferred-edge-limiter.md` must **not** appear: its text already said best-effort, and this commit moves the code to match the ADR rather than the other way round. Confirm with `git show --stat HEAD -- docs/` → no output.
- [ ] **Known residual — one redaction guard is now vacuous and must not be mistaken for coverage.** Read `backend/tests/Gones.IntegrationTests/EventProposalDecisionTests.cs` around the `foreach (var action in audits)` block in `Decision_is_rate_limited`. It asserts that no audit action contains a guessed token — an invariant that used to be live and can no longer execute, because `audits` is now provably empty on that route. The comment directly above it says so in as many words. This is a real loss of coverage, accepted as the mechanical consequence of the ticket's own decision; rebuilding an equivalent guard against the metrics label was ruled out of scope and needs its own ticket. Until then, the "name the route, never the token" property on `/api/event-proposals/by-token/{token}` rests on `AuthRateLimiting.RouteKey` and its doc comment alone.
- [ ] **Known residual — one non-`/api/auth` endpoint is still audited, via the endpoint filter rather than the global limiter.** Run `grep -rn 'AddEndpointFilter<AuthAccountRateLimitFilter>' backend/src` → five call sites. Four are under `/api/auth` (`LocalIdentityEndpoints.cs` register + login, `AccountLifecycleEndpoints.cs` resend-verification + forgot-password). The fifth, `AccountLifecycleEndpoints.cs:58`, is `POST /api/users/me/email-change` (group `users = app.MapGroup("/api/users")` at `LocalIdentityEndpoints.cs:54`, passed in at `:67`). The ticket instructed that `AuthAccountRateLimitFilter.InvokeAsync` keep its unconditional audit call on the stated grounds that "the filter only runs on `/api/auth` endpoints" — which is not true of that fifth site. So an account-limiter rejection there still writes `auth.email_change.rate_limited`. Left exactly as instructed; the outcome is benign (an email-change flood is the same credential-adjacent signal the slice wants durably recorded) and the write can no longer break the 429, but the ticket's rationale was wrong and a future reader should not trust it.
- [ ] **Known residual — `npm run e2e:ci` was not run for this slice.** It is the plan-level closing step and its teardown destroys local database volumes, so it is never run as an automated ticket step. Nothing in this commit touches frontend code, a route, a DTO or a migration, so no e2e spec is expected to change behaviour; run it once at plan end and treat any rate-limit-related failure as belonging to this slice.

## T18 stats-rebuild-incremental

Performance slice, zero behaviour change: `player_statistics` must come out byte-identical while the
rebuild stops doing redundant work. Before this commit every non-deleted archive Tournament was parsed
once per scope it belonged to — and each of those parses was itself double, `JsonDocument.Parse`
followed by `LeagueJson.Deserialize<T>(JsonElement)`, which re-parses `GetRawText()` — so an attached
Tournament cost 3×2 = 6 parses per rebuild. It is now parsed exactly once and the one immutable
`TournamentDocument` is shared by reference across the up-to-three scopes that hold it; scopes are
streamed (`IAsyncEnumerable`) instead of materialized as a list; and the global counting pass no longer
fills a `List<PlayerMatch>` that `GlobalPlayerStatistics` has no member to carry. Run everything from
the repository root. Do **not** run `docker compose down --volumes` at any point.

- [ ] **The rows did not move — and the pins prove it in both directions.** Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~ScopedPlayerStatisticsRebuildTests` → `Passed! - Failed: 0, Passed: 8`. The new one is `Pins_every_row_the_seed_produces`: it spells out all 14 `(scope_kind, scope_id, player_name)` keys and every column of five of them. A pin written after a refactor proves nothing on its own, so check it against the old code too: `git worktree add /tmp/gones-t18-before HEAD~1`, then `git show HEAD:backend/tests/Gones.IntegrationTests/ScopedPlayerStatisticsRebuildTests.cs > /tmp/gones-t18-before/backend/tests/Gones.IntegrationTests/ScopedPlayerStatisticsRebuildTests.cs`, `git show HEAD:backend/tests/Gones.UnitTests/LeagueRulesTests.cs > /tmp/gones-t18-before/backend/tests/Gones.UnitTests/LeagueRulesTests.cs`, and run `dotnet test /tmp/gones-t18-before/backend/Gones.sln --filter "FullyQualifiedName~ScopedPlayerStatisticsRebuildTests|FullyQualifiedName~LeagueRulesTests"` → also `Failed: 0`. Same expected values, old implementation. Clean up with `git worktree remove /tmp/gones-t18-before --force`.
- [ ] **One parse per Tournament, and the double parse is gone.** Run `grep -c "JsonDocument.Parse" backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs` → `1`, and `grep -n "GetRawText\|LeagueJson.Deserialize" backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs; echo "exit=$?"` → no output and `exit=1`. `ReadArray` now reads `element.Deserialize<List<T>>(LeagueJson.Options) ?? []` — the same `LeagueJson.Options` instance as before, so the polymorphic `kind` discriminator on `RoundEntry` and the camelCase naming policy are unchanged; only the round-trip through raw text is gone. `LeagueJson.Deserialize<T>(JsonElement)` itself was deliberately left alone — `LiveParityTests`, `LeagueParityTests` and `LiveAggregate` still use it.
- [ ] **The scope builder can no longer parse anything, which is what makes the sharing structural rather than a promise.** Run `sed -n '/private static ArchiveStatisticsScope Scope(/,/^    }/p' backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs` → the third parameter is `IReadOnlyList<TournamentDocument> documents` and the body contains no `JsonDocument`, no `ReadArray` and no `Select`. Then `grep -n "Select(tournament => tournament.Document)" backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs` → exactly three hits (lines 82, 92, 99: global, League, Season), each of which hands the **same** `TournamentDocument` instances to a different scope. `grep -n "Parse(tournament)" …` → one hit, line 74, inside the single `.Select(...)` that runs before the first `yield return`.
- [ ] **Sharing is safe because the shared thing is immutable.** Run `sed -n '/^public sealed record TournamentDocument(/,/^$/p' backend/src/Gones.Domain/Leagues/LeagueDocuments.cs` → a positional `record` with no `set`/`init` members, holding `IReadOnlyList<RoundDocument>` and `IReadOnlyList<PlayerArchetypeDocument>` which are themselves positional records. If anyone ever adds a mutable member here, the cross-scope sharing this slice introduced stops being sound — that is the invariant to defend, not the `sealed` keyword.
- [ ] **`TournamentDocument.LeagueId` deliberately changed on this path, and nothing reads it.** Every rebuild document is now stamped `"archive"` (`grep -n 'SharedContainerId = ' backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs`) instead of the old per-scope `"{scopeKind}:{scopeId}"`. Confirm nothing on the statistics path reads it: `grep -rn "\.LeagueId" backend/src/Gones.Domain/` → four hits, none of them a read of a Tournament's League id by the statistics maths (`LeagueRules.cs:361` reads `league.Id` against a filter, the two `Live/` hits are the live tournament flow, the fourth is `ArchiveDocumentAdapter.cs:13`, a doc comment that says the standings passes never read it). The value that *does* still matter is the synthetic container's `LeagueDocument.Id`, which keys the `tournamentsPlayed` dedup at `backend/src/Gones.Domain/Leagues/LeagueRules.cs:255` (`$"{league.Id}\u0000{tournament.Id}"`) — `grep -n 'containerId = ' backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs` must still show `$"{scopeKind}:{scopeId}"`. If that one ever collapses to a shared constant too, per-scope `tournaments_played` silently changes.
- [ ] **The scopes are streamed, and the caller counts what it actually consumed.** Run `sed -n '/public async Task RebuildAsync/,/^    }/p' backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs` → `await LockAsync(...)` still comes first, then `await foreach (var scope in ArchiveScopeSource.LoadAsync(database, cancellationToken))` with a `scopeCount++` inside, and no `.ToList()`/`.Count` on the scope sequence anywhere. The ordering matters more than it looks: `LoadAsync` is now a lazy iterator, so its two SELECTs run at the first `MoveNextAsync` — after the advisory lock and, because the loop runs to completion, still before `DELETE FROM player_statistics`. If someone later moves the `DELETE` above the loop, or breaks out of the loop early, that read-vs-delete order inside the caller's transaction breaks.
- [ ] **The log line is byte-identical — the finding's own before/after measurement reads it.** Run `grep -n "Player statistics rebuilt" backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs` → the template is still `"Player statistics rebuilt: {RowCount} rows across {ScopeCount} scopes in {ElapsedMilliseconds} ms."`, now fed `rows.Count, scopeCount`. `git show HEAD~1:backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs | grep -n "Player statistics rebuilt"` prints the same string.
- [ ] **See the cost drop on a real archive (optional; needs Docker and ~20 minutes).** Generate and load the stress dataset: `npm run dev:stress:generate -- --seed=1` then `npm run dev -- --env=stress --detached`. Force a rebuild and time it by making the stored formula version stale: `docker compose exec -T postgres psql -U gones_migration -d gones -c "UPDATE player_statistics_meta SET formula_version = 0;"` (runs inside the `postgres:17-alpine` service, so no local `psql` is needed), then `docker compose restart api && docker compose logs --since 5m api | grep "Player statistics rebuilt"`. Note the `RowCount`, `ScopeCount` and `ms`. Repeat the whole rebuild from the `HEAD~1` worktree of the first step (`cd /tmp/gones-t18-before && GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only' GONES_ALLOWED_ORIGINS=https://app.example GONES_PUBLIC_APP_ORIGIN=https://app.example ASPNETCORE_URLS=http://127.0.0.1:5099 dotnet run --project backend/src/Gones.Api`, after re-staling the version the same way). **`RowCount` and `ScopeCount` must be identical between the two runs** — that is the byte-identity claim on real data, and it is the assertion that matters. The `ms` should be lower on `HEAD`; treat it as an observation, not a pass/fail, because a single timing on a warm-or-cold page cache proves nothing on its own.
- [ ] **The discarded match history really was discarded, so removing it cannot change a row.** Run `sed -n '142,163p' backend/src/Gones.Domain/Leagues/LeagueDocuments.cs` → `GlobalPlayerStatistics` runs from `PlayerName` to `DecayedRating` with no match-history member; the only `Matches` member in that file is at line 131, on `PlayerStatistics`, which the global path never returns. Then `grep -n "trackMatches: false" backend/src/Gones.Domain/Leagues/LeagueRules.cs` → exactly one hit, line 172, inside `CalculateGlobalPlayerStatistics`'s local `EnsureAccumulator`. The unit pin `LeagueRulesTests.Global_statistics_match_the_per_player_counting_path` compares all twelve counted fields of the global rows against `CalculatePlayerStatistics` for the same fixture, so a non-history accumulator that also changed a count would fail there.
- [ ] **The bye path was left unguarded on purpose.** Run `grep -n "Matches.Add" backend/src/Gones.Domain/Leagues/LeagueRules.cs` → two hits: line 373 (the `"bye"` append, unguarded) and line 414 (the `"match"` append, now behind `if (accumulator.TrackMatches)`). Line 373 sits in `CollectLeagueStatistics`, which only ever runs from `CalculatePlayerStatistics` — where `trackMatches` defaults to `true` — so it is unreachable from the global rebuild path and guarding it would have been dead code. If a future change routes a non-tracking accumulator through `CollectLeagueStatistics`, that line has to be guarded too.
- [ ] **The commit is three product files, two test files and this checklist.** Run `git show --stat HEAD` → exactly six entries: `backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs`, `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs`, `backend/src/Gones.Domain/Leagues/LeagueRules.cs`, `backend/tests/Gones.IntegrationTests/ScopedPlayerStatisticsRebuildTests.cs`, `backend/tests/Gones.UnitTests/LeagueRulesTests.cs` and `artifacts/manual_test_checklist.md`. No migration, no ADR, no endpoint, no frontend file, no `LeagueJson.cs`. Confirm with `git show --stat HEAD -- docs/ src/ backend/src/Gones.Infrastructure/` → no output.
- [ ] **Known residual — `CalculatePlayerStatistics(...).Matches` is now guarded only by a default argument, and nothing tests it.** The ticket's premise that this output "is served to clients" is not true at this commit: `grep -rn "CalculatePlayerStatistics(" backend/src backend/tests` → the only caller anywhere is `backend/tests/Gones.UnitTests/LeagueParityTests.cs:75`, and that test strips the field before comparing (`CountsOnly` at `:193-197` removes `"matches"`). The player page builds its history independently in SQL — `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:79`, `BuildHistoryAsync`. So this slice's promise that the per-player path "still records history exactly as before" rests on `StatisticsAccumulator`'s `bool trackMatches = true` default and on reading the one call site, not on a failing test. The blast radius today is nil because no production code reads it, which is why no pin was added inside this ticket's scope; a follow-up that either covers it or deletes the now-unused history is worth a ticket of its own.
- [ ] **Known residual — `npm run e2e:ci` was not run for this slice.** It is the plan-level closing step and its teardown destroys local database volumes, so it is never run as an automated ticket step. This commit touches no frontend file, no route, no DTO and no migration; the only externally observable surface is `player_statistics`, which the pins hold byte-identical. Run it once at plan end and treat any rankings- or player-statistics-related failure as belonging to this slice.

## T19 player-name-read-bounded

Performance slice with one deliberate response-shape change. `GET /api/maintenance/player-names` and
`POST /api/maintenance/player-names/rename-preview` used to read every live `archive_tournaments` row
*including its `document` column*, deserialize each one, walk every player-name slot in memory and
return an uncapped list. Both now answer from a single SQL statement over the `jsonb` column, and the
list gained a ceiling (`Gones:Maintenance:MaximumPlayerNameCatalogSize`, default 5000) plus a
`truncated` boolean. The rename **commit** path is deliberately untouched. Run everything from the
repository root. Do **not** run `docker compose down --volumes` at any point.

- [ ] **What a human actually sees when the ceiling is hit — a silently short list.** Bring the stack up with the ceiling forced to 2: `GONES__MAINTENANCE__MAXIMUMPLAYERNAMECATALOGSIZE=2 npm run dev -- --detached` (the `GONES__X__Y` double-underscore form is how `compose.yaml` already passes `GONES__AUTH__REFRESHCOOKIE__SAMESITE`, and ASP.NET config keys are case-insensitive). Sign in as an Organizer, open **Settings → player names**. You should see exactly **two** names and **no warning, badge, banner or "showing 2 of N" hint of any kind** — the UI reads `items` and ignores `truncated` on purpose (that was ruled out of scope for this slice). Confirm the list really is cut off and not genuinely two names long by comparing against `docker compose logs --since 5m api | grep "Maintenance player-name catalog truncated"` → one line reading `Maintenance player-name catalog truncated: ceiling=2`. **If that log line is the only signal a truncated catalog ever produces, that is the finding to report** — decide whether a real deployment can tolerate an organizer silently editing an incomplete name list. Then restart without the override (`npm run dev -- --detached`) and confirm the full list returns and no further truncation line appears.
- [ ] **The ceiling is off by exactly one, in the safe direction.** At the default there is no truncation, and at a ceiling equal to the number of distinct names there must still be none: the implementation fetches `ceiling + 1` rows and only reports `truncated` when it got more than `ceiling` back. Re-run the previous step with `GONES__MAINTENANCE__MAXIMUMPLAYERNAMECATALOGSIZE` set to the exact number of names the unbounded list returned → all names present, **no** log line, and `truncated` false in the response body. A ceiling of one less → the last name disappears and the line appears.
- [ ] **The search term is a literal substring, not a LIKE pattern.** The Settings screen never sends `search` (it calls `listMaintenancePlayerNames(undefined)` and filters locally), so this surface only exists for API clients and must be poked directly. Signed in as an Organizer in the browser, open devtools on the app tab and run `for (const t of ['%25','_','%5C','li']) console.log(t, await (await fetch('http://127.0.0.1:5080/api/maintenance/player-names?search=' + t, {credentials:'include'})).json())`. The first three must each return `items: []` — a bare `%` or `_` would otherwise match every name, and a bare `\` is the ESCAPE character and would make PostgreSQL reject the pattern outright with a 500. The fourth must return the names containing `li`. A 500 on any of them is a regression in the escaping, not a bad request.
- [ ] **Preview and rename still agree with each other after the read path moved to SQL.** In Settings, pick a player who appears in more than one Tournament, start a rename to a name that already exists in a *different* case, and read the preview: affected-league count, affected-occurrence count and the "merges with an existing player" warning must be what they were before this commit. Then commit the rename and confirm the names change everywhere and the audit trail is written. Preview counts now come from `GROUP BY t.document_id`, the merge flag from a SQL `EXISTS`, and the commit from the untouched `FOR UPDATE` path — a disagreement between preview and commit is the specific bug this slice could have introduced.
- [ ] **Soft-deleted Tournaments still contribute nothing, and case is still exact.** Soft-delete a Tournament that holds a player name found nowhere else (`UPDATE archive_tournaments SET deleted_at = now() WHERE document_id = '<id>';` via `docker compose exec -T postgres psql -U gones_migration -d gones`), reload the Settings list → that name is gone. Then confirm two names differing only by case (e.g. `Alice` and `alice`) are still **two separate rows** with separate counts, ordered case-insensitively with the upper-case one first. Undo the soft delete afterwards (`SET deleted_at = NULL`).
- [ ] **No document is deserialized on either read path any more — that is the whole point of the slice.** Run `sed -n '/public async Task<PlayerNameListResponse> SearchAsync/,/^    }/p' backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs` and the same for `PreviewAsync` → neither body mentions `ReadDocument`, `Carrier`, or `LeaguePlayerNameMaintenance`. Then `grep -n "ReadDocument\|Carrier(" backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs` → every hit is inside `RenameAsync` or the `Carrier` helper it still uses. `grep -c "ActiveTournamentsAsync" …` → `0`.
- [ ] **No user value is ever concatenated into SQL.** Run `grep -n 'SqlQueryRaw\|FromSqlRaw\|NpgsqlParameter' backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs` → the three `SqlQueryRaw` calls each take a compile-time `ListSql` / `ImpactsSql` / `MergeSql` constant plus `NpgsqlParameter` objects, and the only interpolation inside those constants is the `PlayerNameSlotsSql` constant itself. If a future edit ever interpolates `search`, `from` or `to` into the SQL text, this endpoint becomes injectable to any Organizer.
- [ ] **The commit is two backend files plus the two regenerated contract files and this checklist.** Run `git show --stat HEAD` → exactly five entries: `backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs`, `backend/tests/Gones.IntegrationTests/PlayerNameMaintenanceApiTests.cs`, `backend/openapi/gones.json`, `src/app/api/generated/gones-api.ts` and `artifacts/manual_test_checklist.md`. No migration, no ADR, no compose file, no hand-written frontend file. Confirm with `git show --stat HEAD -- docs/ backend/src/Gones.Infrastructure/ backend/src/Gones.Domain/` → no output, and `git show HEAD -- src/app | grep -v 'api/generated'` → nothing but the diff header.
- [ ] **Known residual — the read is still a full scan of `archive_tournaments`, just a much cheaper one.** The finding this slice closes was per-request JSON deserialization in .NET, not the scan itself. There is no index that can serve "every trimmed name in every document", so the query still expands every live Tournament's rounds and entries inside PostgreSQL on every request. It no longer ships documents over the wire or allocates them on the heap, and the ceiling now bounds the response body, but request cost still grows linearly with the archive. If the maintenance screen becomes slow on a large archive, the next step is a materialized name index, not another tweak here.
- [ ] **Known residual — `truncated` has no reader.** `src/app/features/settings/settings.component.ts` reads `response.items` only; the generated client carries `truncated: boolean` and nothing consumes it. That is exactly what the ticket specified, so the field is a contract for future readers and for the log line, not a user-visible signal today. The first step of this section is the check that decides whether that is acceptable.
- [ ] **Known residual — the ceiling is read from config with no clamp.** `configuration.GetValue(MaximumPlayerNameCatalogSizeKey, MaximumPlayerNameCatalogSize)` is used as-is, matching every sibling catalog endpoint, which also clamp nothing. A configured `0` or a negative value yields `LIMIT 1` / a negative `LIMIT` that PostgreSQL rejects with a 500, and `int.MaxValue` overflows `ceiling + 1` to a negative `LIMIT` as well. All three are operator error on an optional key that no deployment sets, and adding a clamp here alone would diverge from the siblings; fix all of them together or none.
- [ ] **Known residual — trimming and ordering are PostgreSQL's, not .NET's.** `btrim(value, E' \t\r\n')` strips space, tab, CR and LF, where .NET `Trim()` also strips rarer Unicode whitespace such as U+00A0; and `ORDER BY lower(s.name) COLLATE "C", s.name COLLATE "C"` reproduces `OrderBy(OrdinalIgnoreCase).ThenBy(Ordinal)` for ASCII but may order exotic case-pairs differently. Stored slots are written from values already trimmed by `LeagueNormalizer.TrimPlayerName`, so the trimming divergence is theoretical. Both were accepted by the ticket; do not "fix" either without a failing case in hand.
- [ ] **Known residual — `npm run e2e:ci` was not run for this slice.** It is the plan-level closing step and its teardown destroys local database volumes, so it is never run as an automated ticket step. This commit changes one public response shape (an added optional-to-read field) and no frontend source file, so no e2e spec is expected to change behaviour. Run it once at plan end and treat any settings- or player-name-related failure as belonging to this slice.

## T20 participants-paginate-cache

Performance slice on the app's most linkable anonymous URL. `GET /api/events/{slug}/participants`
used to return every confirmed registration in one uncached response, and the public Event page
fetched it eagerly inside `load()` on every visit. The endpoint now takes `page`/`pageSize`
(default 20, max 100), returns `page`/`pageSize`/`totalCount` next to `items`, and carries
`ETag` + `Cache-Control: public, max-age=60` with `304` support — the same idiom `/api/events` and
`/api/events/{slug}` already use. The page now loads the roster only after the visitor clicks
**Show participants**, 100 at a time, with a **Show more participants** button underneath. Run
everything from the repository root with `npm run dev -- --detached` (API on
`http://127.0.0.1:5080`, app on `http://127.0.0.1:4200`), seeded via `npm run dev:accounts`. Do
**not** run `docker compose down --volumes` or `npm run db:reset` at any point.

- [ ] **What a visitor sees first: no roster, one button.** Open a published event at `http://127.0.0.1:4200/events/<slug>` signed out, with DevTools → Network filtered on `participants`, and reload. **Zero requests to `/participants` must appear** — that is the entire point of the slice. The Participants panel shows a single **Show participants** button (`data-cy="public-participants-show"`) where the roster used to be, while the ICS link and the sign-in button in the panel header stay exactly where they were. Click it → one request to `/api/events/<slug>/participants?page=1&pageSize=100`, and the roster (or the "No public participants yet." line) replaces the button. The button does not come back afterwards.
- [ ] **What a human sees on an event with more participants than one page.** The UI asks for 100 per page, so a real second page needs 101+ confirmed registrations. Two ways to get there; do at least one. *(a) Seed it:* register 101 accounts against one event, then reload the page, click **Show participants** → exactly 100 names, and a **Show more participants** button (`data-cy="public-participants-more"`) under the list. Click it → one more request with `page=2`, the 101st name is **appended** below the first 100 (the first 100 must not be refetched, reordered or duplicated — check the list length and the Network tab), and the button disappears because the list now matches `totalCount`. *(b) Shrink the page instead:* in `src/app/features/events/public-event-detail.component.ts` temporarily set `const PARTICIPANTS_PAGE_SIZE = 1;`, let the dev server rebuild, and repeat on any event with 2+ participants — same behaviour, one name at a time. **Revert that edit before doing anything else** (`git diff src/app/features/events/public-event-detail.component.ts` must be empty afterwards).
- [ ] **The pager is a pager, not a reload.** While a second page is in flight, the **Show more participants** button is disabled and the already-loaded names stay on screen — no full-panel spinner, no flash of an empty list. Throttle to "Slow 3G" in DevTools to see it, then double-click the button and confirm exactly one extra request is sent.
- [ ] **Registering refreshes an opened roster and only an opened one.** Signed in as a verified user who can register: open the event, click **Show participants** first, then register → the roster reloads from `page=1` and your username appears. Now hard-reload, register on a *different* event **without** opening its roster → in the Network tab, the register POST is followed by requests for the event detail and the capability, **but no `/participants` request at all**. Unregister with the roster open → it refreshes and your name is gone.
- [ ] **The 304 path really answers 304, and the headers are on every 200.** `curl -sSD - -o /dev/null "http://127.0.0.1:5080/api/events/<slug>/participants"` → `HTTP/1.1 200`, an `etag: "…"` header and exactly `cache-control: public, max-age=60`. Replay it with that value: `curl -sSD - -o /dev/null -H 'If-None-Match: "<the etag>"' "http://127.0.0.1:5080/api/events/<slug>/participants"` → `HTTP/1.1 304` with an empty body. Then register or unregister somebody on that event and replay the same `If-None-Match` again → it must come back `200` with a *different* etag, because the roster changed. A `304` after a roster change is a stale-cache bug, and with `max-age=60` a proxy would serve it to every visitor for a minute.
- [ ] **Paging and clamping are the server's, not the client's.** With one confirmed participant on the event: `curl -sS "…/participants" | jq '{page,pageSize,totalCount,items:(.items|length)}'` → `page 1, pageSize 20, totalCount 1, items 1` (the default page size is 20 even though the UI asks for 100). `?page=2&pageSize=1` → `items 0` with `page 2, pageSize 1, totalCount 1` — `totalCount` counts the whole roster, not the page. `?page=0&pageSize=500` → clamped to `page 1, pageSize 100`. `?page=abc` → `400` from the framework binder, not a 500. An unknown or soft-deleted slug still answers `404` with problem code `not_found`.
- [ ] **The roster still never enters an offline cache.** The service-worker rule was deliberately not touched: `/participants$/` stays in `NEVER_CACHEABLE_API_PATHS` and it matches on the URL *path*, so the new `?page=1&pageSize=100` query cannot slip past it. Prove it on the release topology rather than by reading the file — open the app, click **Show participants**, then in the browser console run `(await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url))` and confirm no cached URL contains `/participants`. The request must also carry the `ngsw-bypass: true` header in the Network tab.
- [ ] **Nothing that used to be visible got hidden.** With the roster open, a participant row still shows the username plus only the fields that user made public (first name, last name, location, birth *year*, language) — no email, no full birth date. The empty state ("No public participants yet."), the error state and its **Retry** button all still render: to see the error path, block `**/participants*` in DevTools → Network → Block request URL, reload, click **Show participants** → the alert appears with a working Retry.
- [ ] **Known residual — a failed *second* page collapses the list into the error state.** `loadMoreParticipants()` sets the same `participantsError` flag as the first load, and the template's error branch replaces the whole list, so a network blip on page 3 hides pages 1–2 behind the Retry button; Retry then restarts from page 1. That is the file's existing single-error-flag idiom and the ticket froze it deliberately. Judge whether it is acceptable on a long roster.
- [ ] **Known residual — `page` is not clamped upward.** A request with a very large `page` (near `int.MaxValue`) overflows `(page - 1) * pageSize` to a negative offset and answers `500` instead of an empty page. This is the identical arithmetic `/api/events` has used since before this slice — the ticket required the clamping to stay identical to that sibling, so fixing it here alone would make the two diverge. Fix both together or neither.
- [ ] **Watch this one Cypress spec on the end-of-plan `npm run e2e:ci` — its repair was never executed.** `cypress/e2e/event-registration.cy.js` asserted the old eager roster, so this commit carries a three-line repair to it: the module-level `participants` fixture gained `page: 1, pageSize: 100, totalCount: 1`, the `common()` intercept glob became `'**/api/events/lyon-legacy/participants*'` (the request now carries `?page=1&pageSize=100`), and the test `prompts Visitors to sign in and exposes only public participant fields` gained a `cy.get('[data-cy="public-participants-show"]').click();` before its roster assertion. **That repair was verified only by static match against the two sibling specs that already use this shape (`cypress/e2e/accessibility.cy.js:75`, `cypress/e2e/abuse-surface.cy.js:56,75`) plus `node --check cypress/e2e/event-registration.cy.js` — no Cypress run executed it**, because `npm run e2e:ci` is a plan-level closing step whose teardown destroys local database volumes. Treat it as unproven: when the end-of-plan e2e run happens, watch `event-registration.cy.js` specifically, and read any failure in it as belonging to this slice. Also confirm the `pageSize: 100` in the fixture still matches what the component actually requests (`PARTICIPANTS_PAGE_SIZE` in `public-event-detail.component.ts`) — the two must move together.
- [ ] **The commit is the eight files the ticket names, the repaired spec, and this checklist.** `git show --stat HEAD` → `backend/src/Gones.Api/Events/PublicEventEndpoints.cs`, `backend/tests/Gones.IntegrationTests/EventRegistrationApiTests.cs`, `backend/openapi/gones.json`, `src/app/api/generated/gones-api.ts`, `src/app/features/events/event-registration.service.ts`, `src/app/features/events/public-event-detail.component.ts`, `src/app/features/events/public-event-detail.component.test.ts`, `src/app/i18n/messages.ts`, `cypress/e2e/event-registration.cy.js`, `artifacts/manual_test_checklist.md`. No migration, no config change, and `git show HEAD -- src/app/api/service-worker-cache.ts` prints nothing.

## T21 localstorage-eviction

Audit finding F15. The two per-entity `localStorage` caches created one key per entity visited and
never deleted anything: `gones.player.<name>` (one key per player detail page, up to the server's
5000-match history ceiling per row) and `gones.events.cache.<encoded-url>` (one key per event slug,
full detail including body HTML). Once the per-origin budget filled, every later write threw, the
`catch {}` in the cache helpers swallowed it, and caching degraded with no signal at all. Both
families now go through `writeBoundedCacheValue` in `src/app/shared/catalog-cache.ts`: capped at
**10** player keys and **30** event keys, evicting the oldest by fetch time, and a quota-failed write
evicts its oldest sibling and retries instead of dropping the fresh row. Key names and stored shapes
are byte-identical to before — only *when a key is deleted* changed, so there is no migration and
nothing to reset. Run everything from the repository root with `npm run dev -- --detached` (API on
`http://127.0.0.1:5080`, app on `http://127.0.0.1:4200`), seeded via `npm run dev:accounts` and
`npm run dev:env`. Do **not** run `docker compose down --volumes` or `npm run db:reset` at any point.
Every console snippet below runs in the browser DevTools console on `http://127.0.0.1:4200`; keep
this helper pasted in a scratch buffer, it is used by most steps:

```js
const count = (p) => Object.keys(localStorage).filter(k => k.startsWith(p)).length;
const keys  = (p) => Object.keys(localStorage).filter(k => k.startsWith(p)).sort();
const ages  = (p) => keys(p).map(k => [k, JSON.parse(localStorage[k]).fetchedAt ?? JSON.parse(localStorage[k]).cachedAt]);
```

- [ ] **Drive the player cache to its bound the honest way: visit 11 players.** Run `localStorage.clear()`, reload, then open `/players` and click into **eleven different players** one after another (or navigate directly to `/players/<name>` eleven times, using names that really exist in the seed — `Demo Player 01` … `Demo Player 11` work). After each visit run `count('gones.player.')` in the console. It must climb 1, 2, 3 … up to **10 and then stop at 10** — the 11th visit adds its own key and drops one, it does not make 11. Then run `ages('gones.player.')` and confirm the key for the **first** player you opened is gone while the other nine plus the eleventh are present, and that every remaining `fetchedAt` is newer than the one that disappeared. Before this change the same walk produced eleven keys and would have kept producing one per player forever.
- [ ] **Same bound for events, cap 30.** Fastest honest route is to seed the family and then let a real page visit trip the cap: run `localStorage.clear()`, then `for (let i = 0; i < 30; i++) localStorage.setItem('gones.events.cache.seed' + i, JSON.stringify({ data: {}, cachedAt: new Date(Date.now() - (30 - i) * 60000).toISOString() }));` → `count('gones.events.cache.')` is `30`. Now open a published event at `/events/<slug>` and reload once so the detail response is cached. `count('gones.events.cache.')` must still be **30**, `localStorage.getItem('gones.events.cache.seed0')` must be `null` (it carried the oldest `cachedAt`), `gones.events.cache.seed1` must survive, and `keys('gones.events.cache.')` must contain one new key whose name is the URL-encoded `/api/events/<slug>` request. If you would rather do it with no seeding at all, visit 31 distinct event slugs instead — same outcome, much slower.
- [ ] **What a human sees when the quota is exhausted: nothing breaks, and the fresh row still lands.** This is the whole point of the ticket, so do it on a real page rather than trusting the unit tests. With the player cache already at 10 keys from the first step, fill the rest of the origin budget with one giant unrelated key: `try { let s = 'x'.repeat(1024 * 1024); for (let i = 0; ; i++) localStorage.setItem('filler.' + i, s); } catch (e) { console.log('full at', e.name); }` → it must print `full at QuotaExceededError` (Chrome/Firefox both cap an origin around 5–10 MB). Confirm the store really is full: `try { localStorage.setItem('probe', 'x'.repeat(1024 * 1024)); } catch (e) { console.log(e.name); }` prints `QuotaExceededError`. Now note the current oldest player key from `ages('gones.player.')`, and navigate to a **twelfth** player detail page. What you must see: **the page renders its statistics and match history normally, with no error banner, no red console exception, and no blank panel** — and afterwards `localStorage.getItem('gones.player.<that twelfth name, lowercased>')` is **not** `null`, while the key that was oldest before the visit is gone. That is the evict-and-retry path: the fresh row displaced an old sibling instead of being silently dropped. Before this change the twelfth page still rendered, but its row was thrown away and the cache stopped accepting anything from that moment on. Clean up afterwards with `Object.keys(localStorage).filter(k => k.startsWith('filler.')).forEach(k => localStorage.removeItem(k)); localStorage.removeItem('probe');`.
- [ ] **A corrupt row is reclaimed before a healthy one.** With ten player keys cached, corrupt one of them that is *not* the oldest: `localStorage.setItem(keys('gones.player.')[5], '{');`. Visit one more, previously unvisited player. The corrupted key must be the one that disappears, and the genuinely oldest healthy key must survive — an unreadable row is treated as infinitely old on purpose, so garbage is reclaimed before real data. Re-check with `ages('gones.player.')` (it must not throw; if it does, you corrupted a second key by accident).
- [ ] **Eviction never reaches outside its own prefix.** Before the walk, set the neighbours by hand: pick your language in the UI, sign in once, and confirm `localStorage.getItem('gones.settings.language')`, `gones.auth.sessionGeneration`, `gones.events.catalog`, `gones.global-stats.catalog` and `gones.first-visit.completed` all have values. Now repeat the eleven-player walk from step 1 and the event walk from step 2. Every one of those five keys must still hold **exactly** the same value afterwards — the caps only ever delete keys starting with `gones.player.` or `gones.events.cache.`. Snapshot them with `['gones.settings.language','gones.auth.sessionGeneration','gones.events.catalog','gones.global-stats.catalog','gones.first-visit.completed'].map(k => [k, (localStorage[k] ?? '').length])` before and after and compare.
- [ ] **The TTL contract is untouched.** Open a player page (fills the cache), then reload within a few minutes with DevTools → Network filtered on `players` → **no** request to `/api/players/<name>` goes out, the page serves from the stored copy. Now age that row: `const k = 'gones.player.<name lowercased>'; const e = JSON.parse(localStorage[k]); e.fetchedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString(); localStorage[k] = JSON.stringify(e);` and reload → exactly one request goes out and the row is rewritten with a current `fetchedAt`. Repeat the equivalent on an event page: first load fetches with `200` + `ETag`, second load sends `If-None-Match` and takes the `304` path without changing the displayed content. 24h freshness, ETag revalidation and the offline-stale fallback are all supposed to behave exactly as before this commit.
- [ ] **Known residual — the caps are key counts, not byte budgets.** Ten player rows near the server's 5000-match ceiling are still far larger than thirty small event rows, so "10 keys" is not "10 MB". The bound the ticket froze is deliberately a count, because a byte budget would need to serialise-and-measure every sibling on every write. If you ever see the quota fill *while under both caps*, that is this residual, not a regression: the evict-and-retry path will keep the app working, but the effective cache depth will be lower than 10 on that browser.
- [ ] **Known residual — a store whose `removeItem` silently does nothing would spin.** `writeBoundedCacheValue` retries after each eviction and trusts that `removeItem` actually removed something; a `removeItem` that *throws* is caught and ends the pass safely (this is what a locked-down or private-mode store does), but a hypothetical store that accepts `removeItem` and keeps the key would loop. No browser behaves that way and the ticket froze this implementation shape verbatim, so it was left as written — worth knowing if the app is ever embedded in a webview with a stubbed storage shim.
- [ ] **No e2e ran for this slice.** `npm run e2e:ci` and `npm run cy:run` were deliberately not executed (their teardown destroys local database volumes). No Cypress spec asserts localStorage key counts for these two families, so none needed repair — but at the end-of-plan `npm run e2e:ci`, any failure in a spec that visits many player or event pages in one browser session is worth reading against this commit first.
- [ ] **The commit is the seven files the ticket names plus this checklist.** `git show --stat HEAD` → `src/app/shared/catalog-cache.ts`, `src/app/shared/catalog-cache.test.ts`, `src/app/features/players/player-detail-cache.service.ts`, `src/app/features/players/player-detail-cache.service.test.ts`, `src/app/features/events/public-event.service.ts`, `src/app/features/events/public-event.service.test.ts`, `src/app/backend/server-authority-boundary.test.ts`, `artifacts/manual_test_checklist.md`. No backend file, no migration, no config, no service-worker change: `git show HEAD -- backend/ src/app/api/service-worker-cache.ts` must print nothing.

## T22 shared-idb-fake

Read this first, because it changes what "testing it" means: **this commit ships no application code.** It deletes four copy-pasted in-memory IndexedDB fakes out of four vitest suites and replaces them with one shared helper at `src/app/backend/in-memory-indexeddb.fake.ts`, adds that helper to the boundary test's IndexedDB allowlist, and rewrites two stale header comments that still named `local-league-archive-backend.service.ts` (a file deleted in `4e3eafe`). The fake is test scaffolding: no user can see it, no route reaches it, and nothing below asks you to look for it in the running app. What the steps below do is confirm that the four **real** IndexedDB-backed surfaces the fake stands in for still behave, because the automated proof for those surfaces now runs through one shared implementation instead of four drifted ones — and if that extraction were subtly wrong, the tests would keep passing while the app rotted. So: exercise the real stores, in a real browser, by hand.

The four browser databases involved, all visible under DevTools → Application → Storage → IndexedDB: `gones-live` (Live Tournament browser-local adapter, ADR 0021), `gones-archive-local` (three-tier browser-local archive, ADR 0028), `gones-archive-cache` (public archive catalog + year partitions, ADR 0039) and `gones-cache` (private per-user server read cache, ADR 0031).

- [ ] **The commit really is test-only.** `git show --stat HEAD` must list exactly eight source paths plus this checklist: `src/app/backend/in-memory-indexeddb.fake.ts` (new), `archive-backfill-queue.test.ts`, `archive-cache.service.test.ts`, `local-archive-backend.service.test.ts`, `local-live-backend.service.test.ts`, `server-authority-boundary.test.ts`, `indexed-db.ts`, `server-read-cache.service.ts`, `artifacts/manual_test_checklist.md`. Then confirm the only two non-test source files changed are comment-only: `git show HEAD -- src/app/backend/indexed-db.ts src/app/backend/server-read-cache.service.ts` must show `+`/`-` lines that all begin with ` * ` inside a `/** … */` block and touch no statement. `git show HEAD -- backend/ src/app/features/ src/app/domain/` must print nothing.
- [ ] **The fake is not in the shipped bundle.** Run `npm run build`, then `grep -rl "Injected put failure" dist/` and `grep -rl "in-memory-indexeddb" dist/` — both must find nothing. (`tsconfig.app.json` compiles from `src/main.ts` outward, so an unimported helper cannot reach the bundle; this is the observable proof rather than the argument.)
- [ ] **Live Tournament, browser-local, survives a reload — `gones-live`.** Signed out (or as a plain `User`), with the power-user setting on, go to `/live-tournaments/new`, add four players, save the settings, start a round, score both matches and validate. Open DevTools → Application → IndexedDB → `gones-live` → `tournaments` and confirm one row exists holding your tournament with the players and the scored round. Hard-reload the page (Ctrl+Shift+R) and reopen `/live-tournaments` — the tournament must still be listed, and opening it must show the same stage, the same pairings and the same scores. This is the surface `local-live-backend.service.test.ts` proves; that suite is the one whose fake gained snapshot-rollback and `setTimeout(0)` transaction settling in this commit, so a regression here would show up as a half-written document after a reload.
- [ ] **A failed Live write leaves the stored document untouched, not half-applied.** Still on a running Live tournament, note the current standings, then in DevTools → Application → IndexedDB right-click `gones-live` and use **Refresh** while you score an entry, so the write races a store read. Whatever the UI reports, reload afterwards: the document must be either fully at the old version or fully at the new one — never a round with one entry scored and the standings not recomputed. If you cannot force the race, at minimum score an entry, immediately reload before the toast clears, and confirm the persisted document is internally consistent.
- [ ] **Browser-local archive round-trips — `gones-archive-local`.** As an anonymous or `User` visitor, go to `/archive/league-seasons`, create a League, a Season under it and a Tournament inside that Season, then add a round and import or enter a couple of results. Check DevTools → IndexedDB → `gones-archive-local` holds the `leagues`, `league-seasons` and `tournaments` stores with your rows. Now delete the Season and confirm both of its Tournaments become standalone (they must still appear under `/archive/tournaments`, unattached) rather than disappearing — that detach is a single multi-store transaction and is exactly the behaviour the shared fake's snapshot rollback is there to police. Try deleting a League that still holds a Season: it must be refused with a "not empty" message and the League must still be there afterwards.
- [ ] **Public archive cache fills and is reused — `gones-archive-cache`.** With DevTools → Network open and filtered on `archive`, load `/archive/tournaments` and let it settle. DevTools → IndexedDB → `gones-archive-cache` must show the `leagues`, `league-seasons`, `year-partitions` and `meta` stores, with at least one row under `year-partitions` keyed by a **year number** (`2026`, `2025`, …). Navigate away and back within the 24h TTL: no new catalog request goes out and the list renders from the stored copy. That numeric key is why the shared fake normalizes every key through `String(...)`; a break there would show up as a year partition that is written but never read back, i.e. a list that re-fetches on every visit.
- [ ] **A year partition is whole or absent, never partial.** While `/archive/tournaments` is loading a year for the first time, kill the connection (DevTools → Network → **Offline**) mid-load, then go back online and reload. `year-partitions` must contain either a complete row for that year or no row for it at all — never a row with some tournaments and a missing `completedAt`. A partial row would show as a year that renders with too few tournaments and never repairs itself.
- [ ] **Private read cache fills and is purged on logout — `gones-cache`.** Sign in, visit a page that reads your own data (`/registrations`, then `/settings/account`). DevTools → IndexedDB → `gones-cache` → `reads` must hold rows whose keys start with your user id. Go offline and reload one of those pages: it must still render from the cache rather than erroring. Back online, log out — `gones-cache` must be **empty or gone entirely**. Log in as a *different* account and confirm the first account's rows never reappear.
- [ ] **Blocked site data degrades instead of breaking.** In a fresh profile block storage for the origin (Chrome: lock icon → Site settings → Cookies and site data → Block; or use a strict-mode private window), then load `/`, `/events`, `/archive/tournaments` and `/live-tournaments`. Every page must render with data from the server and no red console exception; only the browser-local Live and browser-local archive *writes* may refuse, and they must refuse with a visible message rather than a blank page. This is the `indexedDbUnavailable` path — the shared fake reproduces it by deleting the global, so it is worth confirming the real thing agrees.
- [ ] **Nothing above is new behaviour.** Every step in this section should behave exactly as it did before this commit. If any of them fails, the cause is either a pre-existing bug this checklist happened to surface for the first time, or the extraction changed a semantic the four suites did not pin — check `git stash`-ing nothing and instead comparing against `git show 70d29af:<file>` for the suite that covers the surface you broke. Do not "fix" it by editing the shared fake to match: the suites are the spec, the app is the subject.
- [ ] **Known residual — a fifth fake was deliberately not migrated.** `src/app/backend/server-read-cache.service.test.ts` keeps its own private IndexedDB fake and is untouched by this commit. It is materially different rather than a drifted copy (raw `IDBValidKey` keys with no string normalization, a `deleteDatabase()` factory method, open-connection tracking that its purge tests assert on, one-object-store-per-transaction, and a thrown `DOMException('Fake requires string keyPath.', 'DataError')`), so folding it in would have changed what the other four suites exercise. `src/app/backend/indexed-db.test.ts` likewise keeps its own small request/transaction stub. If you later touch the private cache's purge behaviour, that is the file to edit — not the shared helper.
- [ ] **Known residual — the ticket's own acceptance grep was wrong and was not "satisfied".** T22 asserted `grep -rn "class FakeObjectStore" src/app` would end at two matches, the shared fake plus `server-read-cache.service.test.ts`. That second file never contained such a class — it uses `interface FakeObjectStoreState` and returns an object literal from `objectStore()`. The real result after this commit is **one** match, `src/app/backend/in-memory-indexeddb.fake.ts`, which meets the underlying requirement (no copy-pasted fake object-store class survives outside the shared helper) more strictly than the written bar. Nothing was added to `server-read-cache.service.test.ts` to reach "two"; treat the number in the ticket as a plan error, not a missing deliverable.
- [ ] **Known residual — the boundary allowlist entry has no ADR behind it.** `server-authority-boundary.test.ts` says in its own comment that adding a file to the IndexedDB allowlist is an ADR decision. `src/app/backend/in-memory-indexeddb.fake.ts` was added under the user decision of 2026-08-27 recorded in `artifacts/GRILL_2026_08_27_gones-audit-fixes/ANSWERS.md`, and the entry's comment says so instead of citing an ADR. If a future reviewer wants that promoted to a real ADR, the entry is the place to point them at.
- [ ] **No e2e ran for this slice.** `npm run e2e:ci` and `npm run cy:run` were deliberately not executed — their teardown destroys local database volumes. No Cypress spec touches the vitest fakes, so none needed repair, but at the end-of-plan `npm run e2e:ci` any failure in a Live Tournament or browser-local archive spec is worth reading against this commit first.
