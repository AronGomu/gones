# Grill: feedback calendar v1 round 4

## Round 1 — rename depth, org admin screen, guard bug, slicing

| # | Question | Answer | Precision |
| --- | --- | --- | --- |
| 1 | Rename depth Tournament → Event | Full: DB + API paths + DTOs + Angular + routes + i18n, old routes redirect | |
| 2 | Event = container or pure rename | Pure rename now | Each event tied to a single tournament, not a DB tournament entity; container modelled later |
| 3 | Org ↔ organizer screen layout | Two-pane master-detail, member chips + user autocomplete | Hundreds of users expected |
| 4 | Membership drives Organizer role | Derived both ways (promote on first, demote on last); Admin role untouched | Organizer must have ≥1 org; org must have ≥1 organizer |
| 5 | /registrations guard fix | Gate all auth guards on session-ready | |
| 6 | Demo logins md scope | DEMO_ACCOUNTS.md at root, generated from dev seeds + asserting test | |
| 7 | Polish defaults confirm | All 13 confirmed as written | |
| 8 | Ticket slicing | Polish → org admin → rename last | |

## Round 2 — rename target set, org invariants (pending answers)

| # | Question | Answer | Precision |
| --- | --- | --- | --- |
| 1 | Rename target set | Calendar domain only: ScheduledTournament→Event, ScheduledTournamentFormat→EventFormat, TournamentProposal(+Recipient)→EventProposal, TournamentLifecycleEvent→EventLifecycleEntry, TournamentRegistrationAttempt→EventRegistrationAttempt, ConsumedTournamentPreviewTicket→ConsumedEventPreviewTicket | TournamentFormat lookup, archive + live untouched — different domains |
| 2 | Old /api/tournaments paths | Hard break, `/api/events/*` only; frontend routes still redirect | |
| 3 | Canonical public route | `/events/:slug`, `/events/new`; `/calendar` stays browse page; old paths redirect | |
| 4 | Removing org's last organizer | Block, 409 `organization_requires_member` | conflicts with R2 Q5 → R3 Q1 |
| 5 | Org creation w/o members | Draft org allowed, cannot publish until ≥1 member | conflicts with R2 Q4 → R3 Q1 |
| 6 | Existing violating rows | Migration auto-heals: member-less orgs archived, org-less Organizers demoted | conflicts with R2 Q5 → R3 Q3 |
| 7 | User picker at scale | Client-side filtering over one full fetch | tension with R1 "hundreds of users" → R3 Q4 |

## Round 3 — org lifecycle rule (pending answers)

| # | Question | Answer | Precision |
| --- | --- | --- | --- |
| 1 | Single rule for zero-member org | Draft lifecycle: 0 members legal + flagged Draft, cannot publish, removing last member allowed → back to Draft | Overrides R2 Q4 409 and R1 "org needs ≥1 organizer" |
| 2 | Published events when org empties/deleted | Emptying gates new publications only; deleting hides future events, keeps past events + all registrations | |
| 3 | Auto-heal one-shot vs recurring | One-shot in the EF migration: member-less orgs soft-deleted, org-less Organizers demoted, audit record written | |
| 4 | Fetch-all user picker guardrail | Cap 500 users, client-side filter, banner + test when cap hit | |

## Facts (scout)

- `/registrations` already guarded by `userGuard` — source: `src/app/app.routes.ts`
- `userGuard` reads `auth.profile()` synchronously, no session-ready await — source: `src/app/auth/auth.guards.ts`
- Admin org screens exist: `/admin/organizations`, `/admin/users`, `/organizer/organizations` — source: `src/app/app.routes.ts`, `src/app/features/admin/`
- Backend org surface: `backend/src/Gones.Api/Organizations/{OrganizationEndpoints,OrganizationService,OrganizationAccess}.cs`
- Search highlight impl reusable: `highlightParts()` + `.match-highlight` — source: `src/app/features/players/player-detail.component.ts`
- Create page `/tournaments/new` → `src/app/features/calendar/organizer-tournament-create.component.ts`; `/events/:slug` currently redirects to `/calendar/tournaments/:slug` — source: `src/app/app.routes.ts`

## Facts (scout, round 2)

- Calendar entity = `ScheduledTournament`; satellites `ScheduledTournamentFormat`, `TournamentProposal(+Recipient)`, `TournamentLifecycleEvent`, `TournamentRegistrationAttempt`, `ConsumedTournamentPreviewTicket` — source: `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`
- `TournamentFormat` is a shared lookup also used by the archive domain — not calendar-owned
- Public API paths to rename: `/api/tournaments`, `/api/tournaments/all`, `/api/tournaments/{slug}`, `/api/tournaments/{slug}/participants`, `/api/tournaments/{slug}.ics`, organizer/publication/registration groups — source: `backend/src/Gones.Api/Tournaments/*.cs`
- Membership already modelled: `OrganizationMember`, managed in `backend/src/Gones.Api/Organizations/OrganizationService.cs` (~500 lines)
- Precedent ADR 0022: frontend redirects kept, API given no alias

## Facts (scout, round 3)

- `Organization` already soft-deletes: `DeletedAt`, `IsActive => DeletedAt is null`, restore path, writes refused when deleted — source: `backend/src/Gones.Domain/Organizations/Organization.cs`

## Shared understanding

- **Goal:** ship the 19 items of `feedback.md` (round 4) as a sequential, commit-sized ticket plan: calendar/detail-page polish, an admin organization ↔ organizer screen, a session-ready auth guard fix, generated demo-account docs, and a full Tournament → Event rename of the calendar domain.

### Settled

**Rename (items 6, 9)**
- Full rename across DB, API, DTOs, Angular symbols, routes and i18n. Calendar domain only.
- Tables: `ScheduledTournament`→`Event`, `ScheduledTournamentFormat`→`EventFormat`, `TournamentProposal`/`TournamentProposalRecipient`→`EventProposal`/`EventProposalRecipient`, `TournamentLifecycleEvent`→`EventLifecycleEntry`, `TournamentRegistrationAttempt`→`EventRegistrationAttempt`, `ConsumedTournamentPreviewTicket`→`ConsumedEventPreviewTicket`.
- Untouched: `TournamentFormat` shared lookup, `LeagueArchiveAggregate`, `LiveAggregate` — archive and live are different domains.
- Event = today's record renamed. One event ties to a single tournament conceptually; no child-tournament entity, no parent-child model in this round.
- API: hard break to `/api/events/*`, no aliases (ADR 0022 precedent).
- Routes: canonical `/events/:slug` and `/events/new`; `/calendar` stays the browse page; `/calendar/tournaments/:slug` and `/tournaments/new` become redirects. Breadcrumb on the create page reads "Create Event".

**Organizations (items 7, 8)**
- One admin screen, two-pane master-detail: org list + create on the left, selected org on the right with member chips and a user autocomplete to add.
- User picker: single fetch of all users, client-side filter, hard cap 500, banner + failing test when the cap is hit.
- Organizer role is derived from membership: first membership promotes `User`→`Organizer`, losing the last membership demotes back to `User`. `Admin` is never changed by membership; an admin may hold memberships as a normal user.
- Draft lifecycle: an org with zero members is legal and flagged Draft. Draft orgs cannot publish events. Removing the last member is allowed and returns the org to Draft — no 409.
- Emptying an org does not touch already-published events. Deleting (soft delete, existing `DeletedAt`) hides future events from the calendar and keeps past events and all registrations.
- One-shot EF migration heals legacy rows: member-less orgs soft-deleted, org-less Organizers demoted, audit record written. Nothing recurring afterwards.
- Admin sees every organization in the event-create picker.

**Auth (item 18)**
- Every auth guard awaits a session-ready signal before deciding, fixing the guest access on `/registrations` and the whole class of races.

**Docs (item 19)**
- `DEMO_ACCOUNTS.md` at repo root, generated from the dev seed fixtures by a script, with a test asserting the file matches the seeds. Covers admin / organizer / user and what each should see.

**Polish, confirmed as written**
- Past calendar days dimmed (reduced opacity + muted number, no strikethrough) — item 1.
- List cards fully clickable; add-to-calendar button stops propagation — item 2.
- Local time only, no GMT suffix — item 3.
- Search-match highlighting reusing `highlightParts()` from `player-detail.component.ts`, in both list and calendar views — item 4.
- Breadcrumb "Create Event" on the create page — item 5.
- Scroll position preserved across month navigation — item 10.
- Card hover lift matching existing app cards — item 11.
- Location as a Google Maps link with icon, new tab — item 12.
- Detail title row `[{format}] {title} ({capacity})` — item 13.
- Date-time and location on one row — item 14.
- "Organization Website" button bottom-right of its section — item 15.
- Register button green, on the same line as add-to-calendar; confirm dialog with a link to my registrations; "My registrations" button removed — item 16.
- Organization id block removed, no block left — item 17.

**Slicing**
- Polish tickets first, then the org admin screen, then the rename as the final sweep.

### Assumptions

- The rename does not touch the C# namespace `Gones.Api.Tournaments` beyond what the entity rename forces, unless the file moves anyway.
- Draft state is derived from member count, not a stored column, unless the query cost proves otherwise during implementation.
- Old frontend routes redirect permanently; no removal ticket is scheduled.
- Cypress data-cy selectors follow the existing project rule in `src/AGENT.md`.

### Out of scope

- Event-as-container-of-many-tournaments data model.
- Server-side paginated user search (deferred until the 500 cap is hit).
- Notification/cancellation flows for events of deleted organizations.
- Renaming the shared `TournamentFormat` lookup, the league archive, or the live domain.
