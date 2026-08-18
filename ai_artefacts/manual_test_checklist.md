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

- [ ] `curl 'http://127.0.0.1:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=100'` against a running server with completed Leagues returns HTTP 200 with all 14 columns (`position`, `playerName`, `playedMatchCount`, `matchWins`, `matchLosses`, `matchDraws`, `matchWinrate`, `playedGameCount`, `gameWins`, `gameLosses`, `gameWinrate`, `nemesis`, `rival`, `mostPlayedArchetype`) plus pagination envelope (`page`, `pageSize`, `totalCount`, `sort`, `direction`).
- [ ] Confirm route `/api/leagues-archive/global-player-statistics` does not conflict with `/{id}`; `curl '/api/leagues-archive/some-league-id'` still returns the League detail.
- [ ] Repeat identical request with `If-None-Match` set to the first response ETag; confirm 304 Not Modified.
- [ ] Active-only and soft-deleted Leagues do not contribute players to global stats.
- [ ] Players whose only appearances are Bye entries are absent from results.
- [ ] `pageSize=20` returns HTTP 400; `sort=unknownColumn` returns HTTP 400; search longer than 200 chars returns HTTP 400.

## T15 global-stats-page-home-nav

- [ ] Visit `/global-stats` as anonymous visitor; confirm page loads with 14 column headers in order: #, Player, Matches, MW, ML, MD, M%, Games, GW, GL, G%, Nemesis, Rival, Archetype.
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
- [ ] Confirm breadcrumb at `/global-stats` reads "Menu > Global Rankings" in English and "Menu > Classement mondial" in French.
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
- [ ] Open the Event detail page; click **Add to Calendar** in the hero — same OS-handler behaviour as above.
- [ ] Confirm `curl -sI http://127.0.0.1:5080/api/events/<slug>.ics | grep -i 'content-disposition\|content-type'` shows `inline` and `text/calendar`.
- [ ] Open DevTools → Network, click Add to Calendar — confirm the response `Content-Disposition` header starts with `inline` and still contains `filename*=<slug>.ics`.
- [ ] The organizer bulk participants CSV export still downloads silently (no chooser) — confirm the `/admin/events/<slug>/participants` download is unaffected.

## T14 event-hero-rework

- [ ] Run `npm run dev -- --env=demo`, open any `/events/{slug}` — the title line reads `<title> (N players) Starting Hour : HH:MM` with venue local time.
- [ ] With `capacity: undefined`, the title shows the "unlimited" wording in parentheses rather than `(undefined players)`.
- [ ] The kicker (organization name) above the title is a clickable link to the organization website; clicking it opens in a new tab with `rel="noopener noreferrer"`.
- [ ] If the organization has no website, the kicker is a plain `<p>` with no anchor.
- [ ] No button row (Live Tournament / Archive Tournament / Organization Website / Add to Calendar block) appears below the date/location row.
- [ ] An **Add to Calendar** button appears immediately below the `<h1>` (before the description) and downloads the `.ics` via OS handler.
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
- [ ] Open a League from `/leagues-archive`, open an Archive Tournament. Confirm a status badge is visible near the top of the heading block — it should read **Completed** (backfilled by T20 for demo data).
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
- [ ] As a Power User with a browser-local league (Settings → power user, then create a League while signed out and record a match for a player who also exists on the server): on that player's page with **Only use online data** checked, only the server matches are listed and the totals are the server's. Uncheck it → the totals grow by exactly the local matches, the local rows appear carrying a **This browser** badge, and no server match is counted twice. Check it again → the local rows and their contribution disappear.
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
