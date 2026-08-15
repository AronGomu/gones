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
