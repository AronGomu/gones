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
