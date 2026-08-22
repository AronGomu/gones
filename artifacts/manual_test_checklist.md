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
