# ADR-0055: Account-scoped Event create drafts

> Status: accepted; planned
> Decided: 2026-09-03
> Owners: Event editor and browser-storage boundary
> Relates: ADR-0044 (Event editor navigation surfaces), ADR-0054 (live local preview)
> Amends: ADR-0020 consequence limiting `localStorage` to preferences and public read cache

## Status

Accepted. Not yet implemented.

## Context

Event create is a long form with Markdown, manual location/timezone, schedule, format, capacity, and immediate image upload. Navigation or browser closure can lose unsent work. Server persistence would turn draft recovery into canonical Calendar data, require new auth/concurrency/delete APIs, and contradict direct publication. Session storage does not survive browser restart.

ADR-0020 removed browser-owned canonical data. Unsent create input is not canonical: API never accepted it, public reads never expose it, no other browser receives it, and successful publication removes it. Still, storing domain-shaped input in `localStorage` looks like reintroduced browser authority unless exception is narrow and tested.

## Decision

1. Latest Event-create draft is stored in `localStorage` under `gones.event-create.draft.<userId>` with schema version, owner user ID, save time, manual form fields including IANA timezone, and at most one Temporary image response.
2. One account can read only its exact key. Logout keeps draft for same account; another account cannot discover it through Event editor. Edit routes never read or write create-draft storage.
3. Draft has no age expiry. Empty user-input shape or successful direct publication/proposal submission removes it. Malformed, unknown-version, or owner-mismatched data is removed and ignored.
4. Manual address and timezone remain durable scalar input. Expired Temporary image disappears while all other form data remains.
5. Create and edit compare normalized current input against mode baseline. Angular navigation asks through translated confirmation; browser unload uses native `beforeunload`. Only successful server write or exact revert clears dirty state.
6. `server-authority-boundary.test.ts` names one storage file as deliberate exception. Draft is never read as Event source, synced, listed, exported, or accepted without normal server validation.

## Consequences

1. Browser restart restores unsent create work without adding server Draft Event state.
2. Event text and venue remain on shared browser disk across logout. Account-key isolation prevents normal UI crossover but does not protect against same-origin script compromise or local browser-profile access.
3. No age expiry means abandoned drafts remain until empty/published or browser storage clears. This is selected recovery behavior.
4. Temporary image expiry can produce partial restore; manual address and timezone remain restorable scalar input.
5. Storage quota/security failure cannot block editor or publication. Failure is logged; recovery persistence may be unavailable.
6. Browser native leave-dialog wording cannot be localized by app.

## Alternatives rejected

1. Server Draft Event rows lost because they create canonical lifecycle, API, concurrency, and cleanup scope not needed for one-browser recovery.
2. `sessionStorage` lost because closing browser loses exact work recovery requested.
3. One browser-wide key lost because shared browsers would expose one account's draft to another.
4. Persisting edit drafts lost because edits must always reload current server Event and preserve optimistic-concurrency truth.
5. Persisting provider identity lost because manual address and timezone need no provider assertion; Temporary image still lasts 24 hours.
