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

- [ ] 1. Add the breadcrumb tests to `src/app/app-breadcrumbs.test.ts`; run `npx vitest run src/app/app-breadcrumbs.test.ts` — red.
- [ ] 2. Add the redirect assertions to `src/app/data-mode-routes.test.ts` (or a new `src/app/app.routes.test.ts` if that file is authority-scoped).
- [ ] 3. Rewrite `calendarRoutes()` and the organizer/admin route entries with the new paths plus redirects.
- [ ] 4. Add the breadcrumb branches and the three new i18n keys to both maps.
- [ ] 5. Rename the calendar-facing i18n keys that still say Tournament.
- [ ] 6. Sweep internal links: `grep -rn "calendar/tournaments\|tournaments/new\|organizer/tournaments\|tournament-requests" src cypress` and update each hit.
- [ ] 7. Run `npx vitest run src/app`, `npm run lint`, `npm run typecheck`.
- [ ] 8. Run `npm run cy:run`.

## Outputs

- Files touched: `src/app/app.routes.ts`, `src/app/app-breadcrumbs.ts` (+ test), `src/app/i18n/messages.ts`, calendar components' links, Cypress specs.
- Behaviour change: canonical `/events/*` routes; old paths redirect; correct breadcrumbs.

## Validation

- [ ] `npx vitest run src/app` passes
- [ ] `npm run cy:run` passes
- [ ] `npm run lint && npm run typecheck` pass
- [ ] manual check: open `/tournaments/new` → lands on `/events/new` with a "Create Event" breadcrumb; open an old `/calendar/tournaments/:slug` bookmark → lands on `/events/:slug`
- [ ] app functional — calendar browse, event detail, create, organizer management and admin deleted-events pages all reachable
- [ ] commit msg draft: `feat(events): make /events the canonical calendar route`
