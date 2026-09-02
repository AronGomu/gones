# ADR-0053: Markdown is Event-description source

> Status: accepted; planned  
> Decided: 2026-08-31  
> Owners: Calendar Event domain, API, frontend  
> Amends: ADR-0024 consequence that proposal review renders description as plain text  
> Relates: ADR-0035 (Event vocabulary)

## Status

Accepted. Not yet implemented. Amends ADR 0024: proposal review safely renders server-derived Markdown HTML instead of plain text; no anonymous organizer-preview call is introduced.

## Context

Current Event model persists sanitized `body_html`. A Markdown editor cannot round-trip authored formatting from HTML without lossy reverse conversion. Persisting source and rendered HTML together creates stale dual authority unless every write proves both values correspond.

Live preview must update without server request, while public/proposal responses must remain server-sanitized. TypeScript and .NET therefore need separate renderers constrained by one explicit syntax/output contract and shared golden fixtures.

Event imgs are separate first-class media. Markdown image syntax would create a second uncontrolled image channel with external tracking/performance/security behavior.

## Decision

1. Event persists nullable `body_markdown` only, maximum 20,000 characters. `body_html` is dropped in reset-required schema change.
2. API derives sanitized `bodyHtml` on reads. Frontend derives live preview locally from same Markdown source.
3. Frontend uses `marked`; backend uses Markdig. Both enable CommonMark plus pipe tables, task lists, strikethrough and autolinks only.
4. Raw HTML and Markdown image nodes are disabled.
5. Heading output maps Markdown h1/h2/h3+ to page-safe h2/h3/h4.
6. Sanitized output allowlist is explicit: `p, br, strong, em, ul, ol, li, h2, h3, h4, a, blockquote, pre, code, hr, table, thead, tbody, tr, th, td, del, input`. Checkbox input permits only `type=checkbox`, `disabled`, optional `checked`; links permit HTTP(S) or root-relative targets.
7. Shared golden fixtures compare normalized TypeScript/.NET output for every supported construct and attack case.
8. Proposal payload stores same Markdown source. Anonymous review response gets server-derived sanitized HTML, not a call to privileged preview endpoint.

## Consequences

1. Rendering cost moves to API reads. Event descriptions are bounded, and correctness of one source is preferred over cached dual state.
2. Two parser deps must remain behaviorally aligned. Golden parity fixtures are mandatory maintenance whenever either dep changes.
3. Raw HTML authors lose custom markup. External inline imgs are impossible by design; Event Image model is sole image channel.
4. Existing local data is reset/fixture-rewritten; no HTML-to-Markdown migration exists.
5. Generated API keeps `bodyHtml` as derived read property while write/management contracts use `bodyMarkdown`; similar names represent intentionally different directions.
6. Proposal review gains formatting safely because server renderer is public-read capable rather than organizer-preview-gated.

## Alternatives rejected

1. Persist HTML only lost because Markdown edits cannot recover source faithfully.
2. Persist Markdown + HTML lost because two columns create stale-state invariant and migration burden.
3. Render Markdown in browser only lost because API/proposal/public consumers need one server safety boundary.
4. Render on server for every keystroke lost because live preview needs instant local response and no network dependency.
5. Shared WASM renderer lost because build/runtime complexity exceeds value; paired native renderers with parity corpus are smaller.
6. Allow Markdown imgs lost because it bypasses Event media ownership, processing, privacy and caching rules.
