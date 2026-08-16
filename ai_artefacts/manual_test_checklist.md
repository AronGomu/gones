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
- [ ] Navigate to any result page `/leagues-archive/:id/tournaments-archive/:id/result` — confirm a top back button appears above; clicking uses browser history back.
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
- [ ] Grant the Organizer role to a user — confirm the list refreshes immediately and the role is shown. In DevTools Network, confirm a new `/api/admin/users*` request was made (invalidation triggered a refetch).
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
