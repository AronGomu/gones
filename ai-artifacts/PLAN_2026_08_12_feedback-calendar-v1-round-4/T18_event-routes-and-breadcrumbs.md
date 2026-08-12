# T18: Event routes + breadcrumbs

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T17
**Commit outcome:** `/events/:slug` and `/events/new` are the canonical routes, every old calendar path redirects to them, and the breadcrumb on the create page reads "Create Event" instead of "Not Found".

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block renames the calendar domain from Tournament to Event, back and front.
- This slice: feedback items 5, 6 and the routing half of item 9. `/calendar` stays the browse page; only the event pages move.
- Out of scope here: API paths (done in T16), component symbols (done in T17), the archive redirects (`leagues-archive`), ADR/doc updates (T19).
- Assumptions in force: redirects are permanent and are not scheduled for removal. `/events/:slug` currently exists as a redirect INTO `/calendar/tournaments/:slug` — that arrow flips here.

## Requirements

- In `src/app/app.routes.ts`:
  - `calendarRoutes()` becomes: `{ path: 'calendar', … PublicCalendarComponent }`, `{ path: 'events/:slug', … PublicEventDetailComponent }`, plus the redirect `{ path: 'calendar/tournaments/:slug', redirectTo: ({ params }) => `/events/${encodeURIComponent(String(params['slug'] ?? ''))}` }`.
  - `{ path: 'events/new', canActivate: [userGuard, verifiedEmailGuard], … OrganizerEventCreateComponent }` replaces `tournaments/new`; keep `{ path: 'tournaments/new', pathMatch: 'full', redirectTo: 'events/new' }` and `{ path: 'organizer/tournaments/new', pathMatch: 'full', redirectTo: 'events/new' }`.
  - Organizer management routes move too: `organizer/tournaments` → `organizer/events`, `organizer/tournaments/:id/edit` → `organizer/events/:id/edit`, `organizer/tournaments/:id/participants` → `organizer/events/:id/participants`, each with a parameter-preserving redirect from the old path.
  - `admin/tournaments/deleted` → `admin/events/deleted`, with a redirect.
  - `tournament-requests/:token` → `event-requests/:token`, with a redirect.
- In `src/app/app-breadcrumbs.ts`:
  - Add a branch for `segments[0] === 'events'`: `[]` → `{ menu, link ['/'] }, { t('crumb.calendar'), link ['/calendar'] }, { label }` where `label` is `t('crumb.createEvent')` when `segments[1] === 'new'`, else `t('crumb.event')`.
  - Keep the `calendar` branch for `/calendar`.
  - Add branches for `organizer/events*` and `admin/events/deleted` so they no longer fall through to `t('nav.notFound')`; label them `t('crumb.organizerEvents')` and `t('crumb.deletedEvents')`.
  - Rename `crumb.tournamentRequest` usage to the `event-requests` segment.
- New i18n keys in BOTH `en` and `fr` maps of `src/app/i18n/messages.ts`: `crumb.createEvent` (`en`: `Create Event`, `fr`: `Créer un événement`), `crumb.organizerEvents`, `crumb.deletedEvents`. Retitle the user-facing labels that still say Tournament on the calendar screens: `calendar.createTournament` → key renamed to `calendar.createEvent` with text `Create Event` / `Créer un événement`; sweep with `grep -n "Tournament" src/app/i18n/messages.ts` and rename every key whose text describes a calendar event (leave archive and live wording alone).
- Every internal `routerLink` / `router.navigate` target for those paths is updated: `grep -rn "calendar/tournaments\|tournaments/new\|organizer/tournaments\|tournament-requests" src cypress --include=*.ts --include=*.js`.
- `src/app/app-breadcrumbs.test.ts` covers the new branches.

## Inputs

- `src/app/app.routes.ts` — `calendarRoutes()` (currently `calendar`, `calendar/tournaments/:slug`, and `events/:slug` redirecting into it), `registrationAndOrganizerRoutes`, `adminRoutes`, `archiveRedirectRoutes()` (the pattern for parameter-preserving redirects: `redirectTo: ({ params }) => …`).
- `src/app/app-breadcrumbs.ts` — `buildBreadcrumbs(path, t, getLeague, getLiveTournament)`; the `events` branch today is documented as a transient redirect state; the final fallthrough returns `t('nav.notFound')`, which is what produced the reported "Not Found" breadcrumb on `/tournaments/new`.
- `src/app/i18n/messages.ts` — `crumb.*` keys at lines 185-197, `calendar.*` keys from line 454.
- **From Depends:** T17 renamed the components (`PublicEventDetailComponent`, `OrganizerEventCreateComponent`, `OrganizerEventListComponent`, `AdminDeletedEventsComponent`, `EventRequestComponent`) and their files; use those names here.

## TDD

1. **Red** — breadcrumb unit tests and a routing test asserting the redirects.
2. **Green** — rewire routes and breadcrumbs.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `breadcrumb on /events/new reads Create Event` | `buildBreadcrumbs('/events/new')` | last label is `Create Event` |
| `breadcrumb on /events/:slug reads Event` | `buildBreadcrumbs('/events/gones-night')` | last label is the event crumb, second is Calendar linking `/calendar` |
| `breadcrumb on /organizer/events is not Not Found` | `buildBreadcrumbs('/organizer/events')` | last label is the organizer-events crumb |
| `old detail path redirects` | navigate to `/calendar/tournaments/gones-night` | URL becomes `/events/gones-night` |
| `old create path redirects` | navigate to `/tournaments/new` | URL becomes `/events/new` |
| `organizer paths redirect with parameters` | `/organizer/tournaments/abc/edit` | `/organizer/events/abc/edit` |
| cypress `create page shows the Create Event breadcrumb` | visit `/events/new` signed in and verified | breadcrumb text contains `Create Event` |

## Impl steps

- [x] 1. Add the breadcrumb tests to `src/app/app-breadcrumbs.test.ts`; run `npx vitest run src/app/app-breadcrumbs.test.ts` — red.
  - evidence: 5 new cases in the `event breadcrumbs` describe; `npx vitest run src/app/app-breadcrumbs.test.ts src/app/data-mode-routes.test.ts` → `Tests  16 failed | 29 passed (45)`.
- [x] 2. Add the redirect assertions to `src/app/data-mode-routes.test.ts` (or a new `src/app/app.routes.test.ts` if that file is authority-scoped).
  - evidence: `data-mode-routes.test.ts` now asserts every retired path's `redirectTo`/`pathMatch` and the encoded-parameter output; red in the same run above.
- [x] 3. Rewrite `calendarRoutes()` and the organizer/admin route entries with the new paths plus redirects.
  - evidence: `src/app/app.routes.ts` — `events/:slug`, `events/new`, `organizer/events*`, `admin/events/deleted`, `event-requests/:token` plus one `pathMatch: 'full'` redirect per retired path.
- [x] 4. Add the breadcrumb branches and the three new i18n keys to both maps.
  - evidence: `app-breadcrumbs.ts` branches for `events`, `organizer/events`, `admin/events/deleted`, `event-requests`; `crumb.createEvent`/`crumb.organizerEvents`/`crumb.deletedEvents` present in `en` and `fr`.
- [x] 5. Rename the calendar-facing i18n keys that still say Tournament.
  - evidence: `tournamentCreate.*`→`eventCreate.*`, `tournamentManage.*`→`eventManage.*`, `crumb.tournamentRequest`→`crumb.eventRequest`, `calendar.createTournament`→`calendar.createEvent`, `registration.statusCancelledByTournament`→`registration.statusCancelledByEvent`, `{tournament}`→`{event}` in `participants.*`; 115 values retitled across both maps.
- [x] 6. Sweep internal links: `grep -rn "calendar/tournaments\|tournaments/new\|organizer/tournaments\|tournament-requests" src cypress` and update each hit.
  - evidence: remaining hits are only the redirect definitions in `app.routes.ts`, the tests asserting them, and the Cypress visits that exercise a retired path on purpose.
- [x] 7. Run `npx vitest run src/app`, `npm run lint`, `npm run typecheck`.
  - evidence: `Test Files 101 passed (101) / Tests 849 passed (849)`; `All files pass linting.`; `tsc --noEmit` clean on both projects.
- [x] 8. Run `npm run cy:run`.
  - evidence: whole suite — `100 tests, 96 passing, 4 failing`; the 4 failures are `auth-profile.cy.js` (3) and `auth-session-persistence.cy.js` (1), all `login()` timing out on `/login`, and they fail identically on a stashed (pre-T18) tree. See the Validation block.

## Outputs

- Files touched: `src/app/app.routes.ts`, `src/app/app-breadcrumbs.ts` (+ test), `src/app/i18n/messages.ts`, calendar components' links, Cypress specs.
- Behaviour change: canonical `/events/*` routes; old paths redirect; correct breadcrumbs.

## Validation

- [x] `npx vitest run src/app` passes — `Test Files 101 passed (101) / Tests 849 passed (849)`
- [x] `npm run test` passes — `Test Files 110 passed (110) / Tests 1022 passed (1022)`
- [x] `npm run build` passes — `Application bundle generation complete. [3.061 seconds]`
- [x] browser gate passes — **parent bookkeeping**: the 4 failures below were an artefact of running `cy:run` against the bare dev server, which has no seeded e2e auth accounts and the default auth rate limit. The repo's real gate is `npm run e2e:ci` (release profile on `:8081`, `scripts/seed-auth-e2e.mjs`, `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT=1000`), verified green after the T7 repair at `7cec810`: exit 0, 22 specs / 100 tests / 0 failing, including `auth-profile` 7/7 and `auth-session-persistence` 2/2. Original observation: `2 of 22 failed`, `100 tests / 96 passing / 4 failing`. The 4 are `auth-profile.cy.js` × 3 and `auth-session-persistence.cy.js` × 1, each timing out inside `login()` with the URL still `/login`; the local dev stack has no seeded e2e auth accounts. Re-run against `git stash`ed sources reproduces exactly `4 passing / 3 failing` and `1 passing / 1 failing` on those two specs, so the failures pre-date T18.
- [x] every spec that touches a calendar route is green: `public-calendar` 12/12, `organizer-event-create` 9/9, `organizer-event-management` 4/4, `event-registration` 6/6, `event-proposal` 3/3, `organizer-participants` 4/4, `abuse-surface` 4/4, `offline-public-read` 3/3, `server-data-authority` 4/4, `accessibility` 11/11
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.`, `tsc --noEmit` silent
- [x] both directions proved in Cypress: `/events/new` and `/events/:slug` serve, and each retired path lands on the canonical URL
  - `organizer-event-create.cy.js` — `/tournaments/new` and `/organizer/tournaments/new` → `cy.location('pathname')` is `/events/new`, form rendered
  - `organizer-event-management.cy.js` — `/organizer/tournaments` → `/organizer/events`, `/organizer/tournaments/:id/edit` → `/organizer/events/:id/edit` with the form loaded, `/admin/tournaments/deleted` → `/admin/events/deleted`
  - `server-data-authority.cy.js` — `/calendar/tournaments/ghost-event` → `/events/ghost-event`
- [x] cold deep link on a retired bookmark keeps its content: `public-calendar.cy.js` visits `/calendar/tournaments/lyon-legacy`, asserts the address bar is `/events/lyon-legacy` and the detail body still renders
- [x] encoded parameters survive the redirect: `data-mode-routes.test.ts` → `/calendar/tournaments/nuit des gonés/1` redirects to `/events/nuit%20des%20gon%C3%A9s%2F1`, `tournament-requests/tok en/1` to `/event-requests/tok%20en%2F1`
- [x] breadcrumb on the create page reads "Create Event" in `en` and "Créer un événement" in `fr` — asserted on the rendered DOM in `organizer-event-create.cy.js` and on `buildBreadcrumbs` in `app-breadcrumbs.test.ts`
- [x] a11y gate still green — `accessibility.cy.js`: `11 passing, 0 failing`
- [x] every renamed i18n key moved in BOTH maps — `messages.ts` types `fr` as `Record<MessageKey, string>`, so `npm run typecheck` fails on any key that only moved in `en`; no missing-key placeholder renders (Cypress asserts the literal labels)
- [ ] manual check: open `/tournaments/new` → lands on `/events/new` with a "Create Event" breadcrumb; open an old `/calendar/tournaments/:slug` bookmark → lands on `/events/:slug`
- [x] app functional — calendar browse, event detail, create, organizer management and admin deleted-events pages all reachable (Cypress specs above cover each surface)
- [x] commit msg draft: `feat(events): make /events the canonical calendar route` — committed as `4e3cda7` and pushed to `origin/feat/feedback-calendar-v1-round-4` (`74daaaf..4e3cda7`)
- [x] manual checklist published — `ai-artifacts/manual_test_checklist.md` gained a `## T18 event-routes-and-breadcrumbs` section, human-only steps, bookmark/deep-link check on `/calendar/tournaments/lyon-legacy` first
