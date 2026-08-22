# Derived Per-Tournament Locking

## Status

Accepted. Not yet implemented. Builds on ADR 0045 (three-tier archive), which gives a Tournament the
row identity this rule attaches to. Amends neither ADR 0028 nor ADR 0037; it adds one refusal that
both must respect — ADR 0028's browser-local records are exempt from it, and ADR 0037's staged-edit
session has to surface it.

## Context

An archive whose old rows keep changing is not an archive. Today nothing stops an organizer editing a
result from three years ago, and the consequences are not local to that row: the player statistics
read model (ADR 0040) is rebuilt wholesale from archive data and now holds Glicko-2 ratings
(ADR 0043), so a typo fix in a 2023 Tournament silently re-rates every player who ever faced anyone
in it and moves a ranking nobody asked to move. The same edit also invalidates catalog caches whose
whole value is that historical data does not move.

So old Tournaments have to stop being writable. The question was what "old" means mechanically, and
where the answer lives.

Four options were considered.

1. **A stored `locked` boolean column, flipped by a scheduled job.** The obvious shape, and the one
   that fails first. It needs a job, and the job has to actually run — a worker that dies on a
   Saturday leaves the archive editable until someone notices. Worse, it makes the lock a fact that
   two systems must agree on: a row fetched and cached today as `locked: false` becomes locked
   overnight with nothing to tell the client, so the browser keeps offering an Edit button for a
   write the server now refuses. Rejected.
2. **Lock at the Season or League tier.** Cheaper — one flag per group. Rejected because a Season can
   hold Tournaments a year apart: locking on the Season's last date leaves genuinely old results
   writable, and locking on its first freezes results played last week.
3. **A manual "close this Season" toggle.** Rejected twice over. It is a chore that will not be done,
   and it turns the lock into a permission question — "who closed it, and can they reopen it?" —
   when the thing being expressed is simply age.
4. **No lock; rely on the audit trail.** Rejected: an audit record says who rewrote history, not that
   history stayed unwritten.

## Decision

**A Tournament locks 365 days after the day it was played, and `locked` is computed, never stored.**

1. **One rule, stated once, implemented twice.**
   `locked ⇔ (today − tournamentDate) > 365 days`, compared on **whole UTC calendar days** with a
   **strict** greater-than. A Tournament played exactly 365 days ago is **not** locked; 366 days ago
   **is**. The frontend definition is
   `isArchiveTournamentLocked(tournamentDate: string, now: Date = new Date()): boolean` in
   `src/app/domain/archive-models.ts`, beside `ARCHIVE_LOCK_WINDOW_DAYS = 365`; the C# mirror is
   `ArchiveLockRule.IsLocked(LocalDate tournamentDate, LocalDate today)` with
   `LockWindowDays = 365`. Calendar days rather than instants, because otherwise the same row locks
   at different moments for two readers in different timezones, and `tournamentDate` is a
   `YYYY-MM-DD` date with no time of day to compare against anyway.

2. **The lock is derived, never persisted.** There is no `locked` column, no scheduled job, no
   backfill and no formula version to bump. The only input is the clock, and both stacks already have
   one. This is the whole reason option 1 was rejected: a derived value cannot drift, cannot be
   half-applied, and cannot be left stale by a worker that did not run.

3. **`locked` is therefore NOT on the wire for a Tournament catalog row.**
   `ArchiveTournamentSummary` carries `tournamentDate` and no `locked` field. Catalog rows are cached
   in IndexedDB — under ADR 0039's 24-hour TTL for open years, and indefinitely for locked years,
   because a locked year cannot change. A `locked: false` written into that cache today is wrong
   tomorrow and nothing would refetch it. `tournamentDate` never changes, so deriving from it makes
   even an old cache entry produce the correct answer.

4. **`locked` IS on the wire for the years index.** `ArchiveYearEntry.locked` is a server-computed
   field on `GET /api/archive/years`. Two facts make that safe, and both are load-bearing. First,
   that endpoint is fetched every session and is never cached across days, so it cannot go stale the
   way a row can. Second, **a year's lock is decidable from the year alone**: the newest possible
   date in year `Y` is 31 December `Y`, so if 31 December `Y` is locked then every Tournament in `Y`
   is locked regardless of its date. The server already walks the years to build the index; making
   the client re-derive one boolean per year from a number it was just handed would be duplicated
   work with no freshness gain. This is a narrow, justified exception to point 3, not a
   contradiction of it.

5. **A write to a locked Tournament is refused for everyone except Admin, with
   `409 archive_tournament_locked`.** The code is snake_case to match the existing wire vocabulary in
   `backend/src/Gones.Api/Errors/ApiExceptions.cs`, which already emits `stale_version`, `not_found`
   and `validation_failed`. The refusal covers every mutating Tournament route: the field patch, the
   season move, round create and delete, round import and replace, entry create, patch and delete,
   the archetype patch, the edit batch, the player rename, and the delete. Admin is exempt because
   someone has to be able to correct a historical record that is genuinely wrong, and an Admin write
   lands in the audit trail.

6. **Browser-local records are never locked.** A record whose id starts with `local-` — ADR 0028's
   entire routing rule, `isLocalLeagueId` in `src/app/data/league-archive-origin.ts:4-9` — lives in
   one person's browser, has no second reader, and feeds no server-side rating. Locking it would be
   the application telling a user they may not edit their own file.

7. **The restore endpoints are exempt.** `POST /api/archive/restore` and
   `POST /api/archive/restore-full` mint new ids and rewrite no protected row; the legacy
   `RestoreOneAsync` at `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:450-461` already
   calls `LeagueCommands.Restore(source, NewId(), name, NewId)` and inserts a fresh aggregate rather
   than touching an existing one. Gating restore on the lock would make bulk historical backfill
   Admin-only, which inverts the intent: importing ten years of results is the use case, and every
   row such an import creates is older than 365 days by definition.

8. **The lock marker is visible, not merely surfaced on refusal.** A 🔒 renders on every locked row in
   both archive tabs, and on a Season when every one of its Tournaments is locked. This is a
   deliberate cost — one more piece of chrome on a dense table — paid so a user learns the rule by
   reading the list rather than by composing an edit and having it thrown away.

## Consequences

- **The lock moves on its own, and the client's answer is only as fresh as its last render.** A tab
  left open across UTC midnight shows an Edit button for a row that just locked. The server is
  authoritative: that edit comes back `409 archive_tournament_locked` and the UI has to say so
  plainly rather than treat it as a transport error. Under ADR 0037 the staged-edit session has to
  fail the whole apply, not part of it.
- **Client clock skew is a real, bounded failure mode.** A browser whose clock is a day fast shows a
  lock the server will not enforce; a day slow, it offers an edit the server refuses. Both resolve to
  the server's answer and neither can corrupt data — the worst case is a confusing button.
- **An Admin edit to locked data is invisible to other browsers until their cache is cleared**, and a
  locked year is cached indefinitely precisely because it was not supposed to change. That staleness
  is accepted, and the manual "Resynchronize everything" control in Settings is its escape hatch.
- **365 is a policy number, not a derived one.** Changing it re-decides what is editable for everyone
  at once with no migration and no backfill — that is the upside of deriving the flag — but also with
  no warning and no grandfathering. Anyone changing `ARCHIVE_LOCK_WINDOW_DAYS` must change
  `ArchiveLockRule.LockWindowDays` in the same commit, and the boundary cases at exactly 365 and 366
  days are the test that proves they agree.
- **The rule is blind to correctness.** A Tournament entered with a wrong date far in the past locks
  immediately, and fixing that date is itself a locked write, so it needs an Admin. A Tournament
  dated in the future is never locked. Both follow from having one input, and neither is worth a
  second rule.
- **Only tournament results freeze.** Leagues and Seasons carry no lock of their own: a Season can be
  renamed and re-parented forever, because its name and its parent League are organisation, not
  history. The season move is the one place the two meet — it is a write to the Tournament row, so it
  is refused with the rest, and reattaching an old Tournament to a different Season needs an Admin.
  That is the intended reading of "the archive is closed": the results are frozen, the shelving above
  them is not.
