# Full-Catalog Calendar Cache and Client-Side Fuzzy Filtering

## Status

Accepted. Amends the Calendar V1 read path; does not touch the write path or ADR 0020's authority.

## Context

The public calendar filtered server-side: six inputs (status, city, country, organization, format,
free text) plus a month window, submitted through an "Appliquer" button, each submission a paged
`GET /api/tournaments` round trip. Every keystroke the user wanted to try cost a navigation and a
request, and the month grid vanished whenever the result set was empty.

The product owner asked for the opposite shape: fetch everything once, cache it for a day, filter
locally through **one** input that fuzzy-matches any tournament data, and keep the calendar visible
even when nothing matches.

The dataset makes that viable. This is a regional association's public calendar — present and future
published tournaments number in the hundreds, not the millions.

## Decision

**One bulk read, cached in the browser for 24 hours; all filtering client-side.**

- New anonymous endpoint `GET /api/tournaments/all[?from=<ISO date>]` returns every non-deleted
  tournament of a non-deleted organization ending at or after now, unpaged, ordered by start instant
  then id, with a strong `ETag` and `Cache-Control: public, max-age=3600`.
- A hard ceiling of 5000 items (`Gones:Calendar:MaximumCatalogSize`) bounds the response. Exceeding
  it sets `truncated: true` and logs a warning; it never fails the request and never silently lies —
  the page renders the truncation notice.
- `AllTournamentsCacheService` stores the payload under `gones.calendar-v1.all-tournaments` with its
  fetch timestamp. Within 24 hours it issues no request at all. A failed refetch with a usable cache
  returns the cache flagged stale rather than throwing.
- A "Synchroniser" button, outside the filter form, forces a refetch. It is the only manual refresh.
- One search input replaces six. `splitSearchTerms` treats `,`, `;` and whitespace as separators
  unless escaped with `\`; terms are ANDed; matching is accent- and case-insensitive and runs over
  every summary field **except** the long description.
- The month grid always renders. The empty state appears below it, not instead of it.

`fuse.js` does the scoring. It is a small, well-maintained dependency and hand-rolling approximate
matching is not where this project's effort belongs.

## Consequences

- The calendar URL loses `status`, `city`, `country`, `organization`, `format` and `page`, and gains
  `q`. Old links still resolve; the dropped parameters are ignored.
- `PublicTournamentService.list` is deleted. `detail` and `icsUrl` remain.
- A second `localStorage` writer joins the documented allowlist in
  `server-authority-boundary.test.ts`. It is a read cache of anonymous GET responses, never a
  mutation source, which is the same justification the existing entries carry.
- Month navigation and the calendar/list toggle no longer touch the network.
- The paged `GET /api/tournaments` stays, contract-tested, unused by this application. It is the
  documented public read API and is cheap to keep honest.
- If the association ever passes 5000 live tournaments, the ceiling is a configuration change and a
  visible warning, not an outage.
