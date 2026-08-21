# Event Routes Without Calendar Aliases

## Status

Accepted. **Supersedes the permanent-frontend-redirect clause of ADR 0035**, for the calendar paths
only. Planned by T1 in `artifacts/PLAN_2026_08_15_feedback-app-wide-round-5.md`.

## Context

ADR 0035 renamed the calendar domain to Event through every ring, and kept the retired frontend
paths alive as permanent redirects so bookmarks would survive. That was the right default at the
time: a redirect is nearly free and a broken bookmark is a real cost.

The browse page was still on `/calendar` after that rename — only the record pages moved to
`/events/:slug`. Finishing the rename means moving the browse page too.

Asked whether `/calendar` should survive as a permanent redirect, the product owner declined
explicitly: retro-compatibility is not wanted here. Gones is unreleased and has no production
environment, so no real bookmark exists to protect. A redirect kept "just in case" is a second name
for a thing that should have one, and every future reader has to learn both.

## Decision

**Delete `/calendar` and `/calendar/tournaments/:slug`.** No `redirectTo`, no alias. A request to
either lands on the 404 page like any other unknown path.

`/events` is the browse page. `/events/:slug` remains the canonical Event page. `/events/new` keeps
matching ahead of `/events/:slug`.

**Scope.** This decision governs the calendar paths this rename touches, and nothing else. The
redirect families that predate it stay exactly as they are:

- `leagues/*` → `leagues-archive/*` (ADR 0022)
- `organizer/tournaments*` → `organizer/events*`
- `tournaments/new` → `events/new`
- `tournament-requests/:token` → `event-requests/:token`
- `admin/tournaments/deleted` → `admin/events/deleted`

Removing those would be a separate decision with its own reasons.

## Consequences

- The word "Calendar" survives in the frontend only where it names the month-grid **view** itself
  (`CalendarView`, `calendarPageCount`, `isPastCalendarDay`) and the ICS file helpers
  (`buildCalendarIcs`). Everywhere else the domain word is Event.
- The feature directory is `src/app/features/events/`, the browse component is
  `PublicEventListComponent`, and message keys live under `event.*`.
- Browser storage keys move from `gones.calendar-v1.*` to `gones.events.*` with **no** migration
  (ADR 0020 permits a local reset while Gones is unreleased). A stale key is ignored, never read.
- An external link written against `/calendar` breaks. That is accepted, deliberately, and is the
  whole point of recording it here.
- **Do not re-add these redirects.** ADR 0035's redirect sentence no longer applies to them. If a
  future reader wants them back, that is a new ADR superseding this one, not a bug fix.
