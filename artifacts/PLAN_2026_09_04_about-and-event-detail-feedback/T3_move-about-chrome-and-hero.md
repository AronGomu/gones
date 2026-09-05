# T3: Move About Chrome and Hero

**Plan:** `./artifacts/PLAN_2026_09_04_about-and-event-detail-feedback.md`  
**Depends:** none  
**Commit outcome:** `/about` owns centered toolbar section nav, no breadcrumb/top-back row, and viewport-wide hero directly below toolbar.

## Context (self-contained)

- C1. Goal: move `about-internal-nav` into app toolbar, remove About breadcrumb/top return row, and make hero borderless/full bleed.
- C2. This slice: shell route-state/template, About hero structure, responsive menu, ADR 0044 exception.
- C3. Out of scope here: Next Up internals, static tournament copy/media, non-About toolbar behavior.
- C4. Assumptions in force: `/about` remains a routed page with bottom back btn; toolbar brand/auth actions remain available.

## Requirements

- R1. Shell detects exact path `/about`, ignoring query/hash through existing `pathOnly()`.
- R2. On `/about`, render direct section links centered between brand and auth controls for widths above `760px`.
- R3. At `max-width: 760px`, hide direct links; render Material text btn `Sections` with same 4 menu items.
- R4. Link order/targets: Association `#association`; Tournaments `#tournaments`; Staff `#staff`; Calendar `/events`.
- R5. Hide entire breadcrumb nav on `/about`; preserve breadcrumbs elsewhere.
- R6. Remove About-local nav and top `gones-back-button`; keep bottom back btn.
- R7. Make hero viewport-wide directly under toolbar, without border/side gap; image covers box without distortion.
- R8. Use `assets/images/in-use/2025-01-ice-mtgones-10-years.jpeg`; T5 performs asset move, so T3 may temporarily reference future path only if T3+T5 land together. Preferred: keep old path until T5 updates it to keep each commit green.
- R9. Remove hero kicker + hero Calendar/team actions; keep title + two approved lede paragraphs.
- R10. Add all new shell/menu elements with unique feature-prefixed `data-cy` attrs.
- R11. Record `/about` as deliberate ADR 0044 exception in ADR 0058; add one back-pointer to ADR 0044.

## Inputs

- I1. `src/app/app.component.ts` — shell toolbar, route state, breadcrumbs.
- I2. `src/app/features/menu/about.component.ts` — local nav, back btns, hero.
- I3. `src/styles.css` — toolbar/About geometry, `760px` breakpoint.
- I4. `src/app/shared/back-button-coverage.test.ts` — executable back-btn rule.
- I5. `src/app/app-breadcrumbs.test.ts` and app component tests — shell route behavior.
- I6. `src/app/i18n/messages.ts` — About nav/menu + hero copy in `en`/`fr`.
- I7. `docs/adr/0044-back-button-below-breadcrumb-root.md` — existing rule amended by this decision.
- I8. `AGENT.md` — binding back-btn rule + newest-ADR register text.
- I9. **From Depends:** none.
- I10. **Plan output to implement:** `docs/adr/0058-about-route-chrome.md` records accepted planned exception; this ticket adds implementation evidence when green.

## Interface contract (level 5)

- P1. **Produces:** `readonly isAboutPage = computed(() => this.pathOnly(this.currentUrl()) === '/about');` on `AppComponent`.
- P2. **Produces:** desktop nav `[data-cy="about-toolbar-nav"]` with links `about-toolbar-association`, `about-toolbar-tournaments`, `about-toolbar-staff`, `about-toolbar-calendar`.
- P3. **Produces:** narrow trigger `[data-cy="about-toolbar-sections-button"]`, visible text from `about.nav.sections = 'Sections'`; menu `[data-cy="about-toolbar-sections-menu"]`; item IDs mirror P2 with `-menu` suffix.
- P4. **Consumes:** `currentUrl()` route signal; `i18n.t('about.nav.*')`; Angular `MatMenuModule`; `RouterLink` for `/events`; normal fragment anchors for same-page sections.
- P5. **Errors:** none. Missing fragment target leaves native URL hash behavior; no swallowed nav failure.
- P6. **Invariants:** direct nav xor menu trigger at breakpoint; link order stable; no duplicate breadcrumb/nav/top-back chrome; non-About shell DOM unchanged.
- P7. **Hero DOM:** first About route content is `[data-cy="about-hero"]`; img `[data-cy="about-hero-image"]`; no `about-hero-kicker`, `about-hero-actions`, `about-hero-calendar-link`, `about-hero-team-link`.
- P8. **Integration links:** Router `NavigationEnd` → `updateRouteState()` → `currentUrl` → `isAboutPage` → toolbar/breadcrumb branches → observe shell DOM at `/about` and another route.

## TDD

1. **Red** — add failing shell/About/back-btn tests for `/about` desktop/narrow DOM, breadcrumb absence, top-back absence, bottom-back presence, hero geometry hooks.
2. **Green** — move nav, add responsive Material menu, branch breadcrumb, trim About hero/chrome, add min CSS.
3. **Refactor** — dedupe link labels/targets only if existing template becomes inconsistent; keep green.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| About shell | route `/about` | toolbar nav present; breadcrumb absent |
| Other shell | route `/events` | About nav absent; breadcrumb present |
| Desktop | viewport `>760px` | 4 direct links; Sections btn hidden |
| Narrow | viewport `<=760px` | direct links hidden; Sections btn/menu available |
| Menu keyboard | focus trigger; Enter/Escape | menu opens; focus returns on close |
| Back contract | About source | top btn absent; bottom btn present |
| Hero contract | About DOM/CSS | first content under toolbar; viewport width; no border/gutter; `object-fit:cover` |
| Hero copy | EN/FR maps | approved 2-line title + 2 paragraph values |

## Impl steps

- [ ] 1. Write shell route/chrome tests.
  - [ ] 1.1 Pin `/about` vs non-About branches.
  - [ ] 1.2 Pin direct-link/menu breakpoint contract.
- [ ] 2. Write About/back-btn tests.
  - [ ] 2.1 Require no local nav/top btn/kicker/actions.
  - [ ] 2.2 Require bottom btn + full-bleed hero hooks.
- [ ] 3. Implement shell nav.
  - [ ] 3.1 Add `MatMenuModule` + `isAboutPage`.
  - [ ] 3.2 Add direct nav + narrow Sections menu.
  - [ ] 3.3 Suppress breadcrumb only on `/about`.
- [ ] 4. Trim About chrome + hero.
  - [ ] 4.1 Remove local nav/top btn/kicker/actions.
  - [ ] 4.2 Split lede into two `<p>` nodes.
  - [ ] 4.3 Apply viewport-wide/no-border geometry + update scroll offsets.
- [ ] 5. Update architectural guardrails.
  - [ ] 5.1 Update back-button coverage test.
  - [ ] 5.2 Verify ADR 0044 back-pointer + `AGENT.md` exception/register remain accurate; after green, add ADR 0058 `Implemented` evidence.

## Validation

- [ ] V1. focused shell/About tests pass: `npm test -- --run src/app/features/menu/about.component.test.ts src/app/shared/back-button-coverage.test.ts src/app/app-breadcrumbs.test.ts`
- [ ] V2. agent-rule ADR register passes: `npm test -- --run ops/agent-rules.test.ts`
- [ ] V3. typecheck + lint pass: `npm run typecheck && npm run lint`
- [ ] V4. manual desktop check: `/about` toolbar links centered; hero begins at toolbar border
- [ ] V5. manual `760px` check: Sections btn opens 4 items; keyboard/focus work
- [ ] V6. manual route transition: `/about` → `/events` restores normal breadcrumb/shell
- [ ] V7. no silent-failure swallow on path this slice adds — `none`
- [ ] V8. app functional — all 4 About nav destinations work; bottom return btn works
- [ ] V9. commit msg draft: `feat(about): dedicate route chrome to full-bleed story`
