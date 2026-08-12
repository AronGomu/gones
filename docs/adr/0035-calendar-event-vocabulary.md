# Calendar Event Vocabulary

## Status

Proposed. Follows the precedent set by ADR 0022 (rename the archived League feature), including its
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

**Three things keep their names.** The shared `TournamentFormat` lookup (`tournament_formats`) is
used by the archive domain too. `LeagueArchiveAggregate` and `LiveAggregate` are separate domains
(ADR 0022, ADR 0021). Renaming them would widen the diff without clarifying anything.

**No API aliases.** `/api/tournaments/*` returns 404 after the rename, as ADR 0022 decided for the
archive. The only client is this repository's frontend, renamed in the adjacent commit.

**Frontend redirects, permanently.** `/calendar/tournaments/:slug` → `/events/:slug`,
`/tournaments/new` → `/events/new`, `/organizer/tournaments/*` → `/organizer/events/*`,
`/tournament-requests/:token` → `/event-requests/:token`, each preserving its parameters. Bookmarks
are a real user's problem; a stale HTTP client is not.

## Consequences

- One EF migration renames tables, columns, indexes and constraints in place — `RenameTable`, never
  a drop and re-create. Every row survives.
- The OpenAPI document and the generated Angular client are regenerated in the API commit; the
  frontend is knowingly mid-rename for exactly one commit.
- `/calendar` stays the browse page: the calendar is a view, not a namespace.
- Documentation, the glossary and the acceptance matrix must state that "scheduled tournament" is a
  retired term.
