# Rich-content sanitizer migration report (C40)

Scope: the only user-authored HTML in Gones Calendar V1 — the Scheduled Tournament `bodyHtml`
field. Everything else the app renders is plain text bound through Angular interpolation and is
therefore escaped by the framework.

## Before

- `bodyHtml` was accepted by the API, sanitized server-side, and handed to the browser.
- The Angular renderer called `DomSanitizer.bypassSecurityTrustHtml` on the API value, with the
  server contract as the only guarantee. `withSafeExternalLinks` only added `target`/`rel` to
  external anchors; it did not verify that the markup matched the allowlist.
- Net effect: a compromised, mis-deployed, or downgraded API — or any future code path that reached
  the same component with unsanitized HTML — turned directly into stored XSS in every viewer's
  browser.

## After

Two independent enforcement points, with the server remaining the sanitizer of record.

| Layer | Component | Behaviour on disallowed markup |
| --- | --- | --- |
| Server (authoritative) | `TournamentContentSanitizer` in `backend/src/Gones.Domain/Calendar/Event.cs` | Rejects the write (`validation_failed`, HTTP 400) or drops the node before storage. Content is never persisted unsanitized. |
| Client (defense in depth) | `withSafeExternalLinks` in `src/app/features/events/server-sanitized-html.component.ts` | Unwraps the element to its text content and strips every non-allowlisted attribute before `bypassSecurityTrustHtml`. |
| Browser | CSP served by `deploy/nginx/default.conf` | `script-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `img-src 'self' data:` — inline and remote script from injected markup cannot execute. |

### Allowlist (identical on both sides)

- Elements: `p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `h2`, `h3`, `a`.
- Attributes: `href`, `target`, `rel` — on `a` only.
- `href` must be `http(s)://…` or an in-app absolute path. `javascript:`, `data:`, and every other
  scheme is dropped.
- External `http(s)` anchors are rewritten to `target="_blank" rel="noopener noreferrer"`.

### What is dropped rather than rejected client-side

The client mirror never fails the render; it degrades. A disallowed element is replaced by its own
text content so an operator sees mangled-but-present copy rather than a blank page, and the drop is
observable in the DOM (no `<script>`, `<iframe>`, `<img>`, `<style>`, `<form>`, `<svg>`, `<object>`).
Inline styles and `class` are removed from allowed elements too, so hostile markup cannot be used to
overlay or hide legitimate UI.

## Migration impact on existing data

No stored content changes. Every `bodyHtml` row already passed the server sanitizer at write time
(C26), so the client mirror is a no-op for all existing data — verified by the publication and
detail suites, which assert allowlisted formatting still round-trips (`<strong>`, `<h2>`, `<li>`,
`href="https://…"`). Nothing needed a backfill and no migration was written.

## Verification

| Evidence | Location |
| --- | --- |
| Server rejects 8 XSS payload shapes before storage | `Body_html_xss_payloads_are_rejected_before_storage` — `backend/tests/Gones.IntegrationTests/TournamentPublicationApiTests.cs` |
| Plain-text fields round-trip as data, never markup; `nosniff` + JSON content type | `Text_fields_are_stored_escaped_and_never_rendered_as_markup` — same file |
| Client mirror drops 7 hostile element shapes, event handlers, and dangerous hrefs, including nested ones | `src/app/features/events/server-sanitized-html.test.ts` |
| Rendered page executes nothing and contains no remote image/script | `cypress/e2e/abuse-surface.cy.js` |
| Response headers (CSP, Permissions-Policy, referrer, COOP/CORP, HSTS-over-TLS-only) | `backend/tests/Gones.IntegrationTests/ApiBoundaryTests.cs` |

## Residual risk

- `src/index.html` still loads the Material Icons stylesheet and fonts from `fonts.googleapis.com`
  / `fonts.gstatic.com`. The CSP names those hosts explicitly and allows no remote script or image.
  Self-hosting the icon font is a follow-up, not a C40 blocker.
- The client mirror duplicates the server allowlist. The two lists are cross-referenced in comments;
  a future change to either must update both. Both are covered by the suites above, so a drift
  shows up as a failing test rather than silently.
