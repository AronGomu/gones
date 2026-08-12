# Calendar Event Vocabulary

## Status

Accepted. Follows the precedent set by ADR 0022 (rename the archived League feature), including its
no-API-alias rule.

## Context

Three different things in this repository are called "tournament": the Calendar V1 record people
register for, the historical result tournament inside an archived League, and the live tournament
being run in the browser. ADR 0022 already renamed the archive. The calendar record is the one users
see first, and it is not a tournament — it is an event that hosts one tournament (and, later,
possibly several).

Renaming has a cost that rises by ring: routes are free, UI labels cheap, API paths break clients,
DB tables need a data-preserving migration.

## Decision

**Rename the calendar domain to Event, through every ring.** Entities and tables:
`ScheduledTournament` → `Event` (`scheduled_tournaments` → `events`), `ScheduledTournamentFormat` →
`EventFormat`, `TournamentProposal(+Recipient)` → `EventProposal(+Recipient)`,
`TournamentLifecycleEvent` → `EventLifecycleEntry`, `TournamentRegistrationAttempt` →
`EventRegistrationAttempt`, `ConsumedTournamentPreviewTicket` → `ConsumedEventPreviewTicket`. API:
`/api/tournaments/*` → `/api/events/*`. Frontend: services, components, types and `data-cy` values.
Routes: `/events/:slug` and `/events/new` are canonical.

**An Event is today's record renamed, nothing more.** No child-tournament entity is introduced. An
event is tied to a single tournament conceptually; that tournament has no database row of its own.
Modelling an event as a container of several tournaments is deliberately deferred.

**Three domains keep their names.** The shared `TournamentFormat` lookup (`tournament_formats`) is
used by the archive domain too. `LeagueArchiveAggregate` and `LiveAggregate` are separate domains
(ADR 0022, ADR 0021). Renaming them would widen the diff without clarifying anything.

**No API aliases.** `/api/tournaments/*` returns 404 after the rename, as ADR 0022 decided for the
archive. The only client is this repository's frontend, renamed in the adjacent commit.

**Frontend redirects, permanently.** `/calendar/tournaments/:slug` → `/events/:slug`,
`/tournaments/new` → `/events/new`, `/organizer/tournaments/*` → `/organizer/events/*`,
`/tournament-requests/:token` → `/event-requests/:token`, each preserving its parameters. Bookmarks
are a real user's problem; a stale HTTP client is not.

## Shipped, and where it diverged

The entity, table, API and route maps above are what `20260812164333_RenameCalendarTournamentToEvent`
and `src/app/app.routes.ts` actually contain. `consumed_tournament_preview_tickets` →
`consumed_event_preview_tickets` belongs in the table list too; the decision named only the entity.
The redirect list shipped two entries wider than decided: `/organizer/tournaments/new` →
`/events/new` and `/admin/tournaments/deleted` → `/admin/events/deleted`.

The rename stopped short of a handful of identifiers on purpose. They are named here so that a
reader who greps for `Tournament` in the calendar domain knows which hits are the decision and which
would be a defect:

| Identifier | Where | Why it stayed |
| --- | --- | --- |
| `ScheduledTournamentStatus`, `ScheduledTournamentDraft` | `backend/src/Gones.Domain/Calendar/Event.cs` | the status enum and the write-side draft record of `Event`; renaming them is a pure CLR churn with no wire, table or URL effect |
| `PlannedScheduledTournament`, `MigrationPlan.ScheduledTournaments` | the migration-import planner and its operator report | the one-way import door of ADR 0020 reads bundles written before this rename; the plan and the printed report speak the vocabulary of the bundles they describe |
| `tournament-proposal`, `tournament-proposal-rejected` | `NotificationContracts` | notification template keys and outbox dedupe keys; renaming them would re-send mail already deduplicated under the old key |
| `scheduled_tournaments.*`, `tournament_registration_attempts.*`, `tournament_lifecycle_events.*` | the `relations` array of the `account_owns_records` 409 (ADR 0025) | shipped wire strings pinned by `src/app/features/settings/account-delete.test.ts`; they no longer match a table name, which ADR 0025 now records |
| `gones.calendar-v1.all-tournaments` | `src/app/features/calendar/all-events-cache.service.ts` | a `localStorage` key; renaming it would silently discard every reader's cached catalogue |
| export/import bundle keys, CSS class names | `src/app/domain`, the stylesheets | wire format (ADR 0022's precedent) and pure presentation |
| `data-cy="admin-nav-deleted-tournaments"` | `admin-home.component.ts` | the one `data-cy` the rename missed; harmless, and moving it churns a Cypress selector for nothing |
| `event.tournamentEvent` | `src/app/i18n/messages.ts` | a dead i18n key in both catalogues, kept out of this rename's diff |

## Consequences

- One EF migration renames tables, columns, indexes and constraints in place — `RenameTable`, never
  a drop and re-create. Every row survives.
- The OpenAPI document and the generated Angular client are regenerated in the API commit; the
  frontend is knowingly mid-rename for exactly one commit.
- `/calendar` stays the browse page: the calendar is a view, not a namespace.
- Documentation, the glossary and the acceptance matrix must state that "scheduled tournament" is a
  retired term. Done in `docs/CONTEXT.md`, `docs/GLOSSARY.md` and `ops/acceptance-matrix.json`.
- ADRs 0023 and 0030 quote `/api/tournaments*` paths from before this rename. They are historical
  records and keep their text; each carries a one-line pointer to this ADR instead.
