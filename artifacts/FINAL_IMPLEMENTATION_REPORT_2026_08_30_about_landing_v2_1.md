# Final Implementation Report — About Landing v2.1

State: **done**

Implementation replaced only `/about` with approved Next-Up Ledger landing, live cached upcoming Events, complete organization content, responsive media, accessible motion, recovery states, bilingual copy, roster, contacts, and existing shell/back-route behavior.

## Ticket State List

- T1. **DONE** — Public interactions, anchors, CTAs, social states, ordered roster, asset contracts, EN/FR catalog. Ticket commit `beae4e5`; merged by `1f1609b`.
- T2. **DONE** — Strict future Event selector, first-three ledger, shared catalog cache, sync, stale/loading/empty/error/retry states, latest-request-wins protection. Ticket commits `967c7a5`, `8babc3e`, `8b2586f`; merged by `24fdc4e`.
- T3. **DONE** — Approved hero, association story, five tournament concepts, Fire/Ice section, League explanation, full staff/contributor roster, contact close, scoped responsive CSS. Ticket commits `ef05ca0`, `c573388`; merged by `b3f442d`.
- T4. **DONE** — One-shot reveal observer, focus safety, reduced-motion reset, fine-pointer motion, sticky-fragment offsets, responsive image caps, release gates. Ticket commit `ed210be`; merged by `f3ec6ee`.

## Evidence

- E1. Focused About tests: 33/33 passed.
- E2. Shared coverage/back-button/first-visit tests: 17/17 passed.
- E3. Full Vitest suite: 165 files, 2127 tests passed.
- E4. `npm run typecheck`: passed.
- E5. `npm run lint`: passed — `All files pass linting.`
- E6. `npm run build`: passed; output `dist/gones`.
- E7. Browser matrix: validated normal + reduced motion at 375×812, 390×844, 768×1024, 1440×900. No horizontal overflow; 7/7 content images loaded per viewport; content images stayed within 380.5px measured cap.
- E8. Reduced-motion observation: opacity 1, transition 0s, transform none, scroll behavior auto.
- E9. Impeccable detector ran exactly once after UI completion. Dynamic Angular `[src]` reports classified false positives; remaining typography/color advisories belonged to approved T3 design. No actionable T4 finding remained.
- E10. Staged-diff secret scans passed before each publication.
- E11. `main` pushed through `f3ec6ee`.

## Files Touched

- F1. `src/app/features/menu/about.component.ts`
- F2. `src/app/features/menu/about.component.test.ts`
- F3. `src/app/features/menu/about-upcoming-events.ts`
- F4. `src/app/features/menu/about-upcoming-events.test.ts`
- F5. `src/app/i18n/messages.ts`
- F6. `src/app/shared/card-hover-contract.test.ts`
- F7. `src/styles.css`

## Assumptions

### A1 — Approved visual authority

`landing-v2-1-nextup-ledger.html` plus `docs/DESIGN.md` remained visual authority. No new concept selection occurred.

### A2 — Biography localization

Tracked `feedback.md` supplied Alex, Luka, and Loïc EN/FR biographies. Approved English grammar corrections from visual authority were retained; supplied French remained unchanged. Gregory French biography renders in both locales. Alex role remains hidden.

### A3 — Event-state runtime evidence

Local API was unavailable during final browser matrix, so browser observation covered recoverable error state. Executable component tests covered loading, live, empty, stale, retry, forced sync, and latest-request-wins behavior.

### A4 — Shell boundary

`/`, `HomeMenuComponent`, first-visit guard, route ownership, toolbar, breadcrumb, and back-button behavior remained outside landing replacement scope.

## Residual Risks

- R1. `HomeMenuComponent` uses `fire-ice.jpg` outside Fire/Ice section, conflicting with `docs/DESIGN.md` exclusivity. Pre-existing `/` behavior was explicitly out of scope; no silent fix applied.
- R2. Build still reports pre-existing unused `RouterLink` warnings in `AdminOrganizationsComponent` and `AdminUsersComponent`.
- R3. Live API state matrix was proved by tests rather than final browser observation per A3.

## User TODO

- U1. None required for implementation or publication.
- U2. Optional future ticket: replace Home Menu Fire/Ice art to resolve R1 without altering this landing scope.
