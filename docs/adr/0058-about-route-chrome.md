# ADR-0058: About route owns dedicated shell chrome

> Status: accepted; implemented
> Decided: 2026-09-04
> Owners: app shell, About page
> Relates: ADR-0038 (canonical Event route), ADR-0044 (back-button coverage)
> Amends: ADR-0044 (the About route keeps bottom back navigation but drops top back navigation)

## Status

Accepted and implemented. Evidence: `src/app/app.component.ts`, `src/app/features/menu/about.component.ts`, `src/styles.css`, plus focused shell/About/back-button tests.

## Context

`/about` is a long editorial page. Existing shell renders sticky toolbar, sticky breadcrumb row, then About renders top back row and another sticky internal-nav row before hero. Four stacked chrome layers separate hero from toolbar and consume vertical space. `src/app/app.component.ts` owns toolbar and breadcrumbs; `src/app/features/menu/about.component.ts` owns both back buttons and internal nav. `src/app/shared/back-button-coverage.test.ts` enforces top + bottom back buttons on every non-root, non-auth route.

About is now explicitly designed as viewport-wide editorial entry: hero starts at toolbar boundary, section nav belongs in remaining toolbar space, breadcrumb is redundant, and bottom back navigation remains available after long content. This makes `/about` a deliberate exception to ADR-0044, not accidental coverage drift.

## Decision

1. `/about` section navigation is shell-owned and rendered inside `.app-toolbar`.
2. Wide layouts expose direct links in order: Association, Tournaments, Staff, Calendar. Narrow layouts at `max-width: 760px` expose same targets through Material text button `Sections`.
3. `/about` renders no breadcrumb row and no top `gones-back-button`.
4. `/about` keeps bottom `gones-back-button`, returning to menu.
5. About hero begins directly under toolbar and may span viewport width. Shell chrome must not insert another row above it.
6. Non-About routes retain existing breadcrumb and ADR-0044 back-button rules.
7. `src/app/shared/back-button-coverage.test.ts` and shell/About component tests pin exception and prevent it spreading to another route.

## Consequences

1. About gains more vertical room and one route-specific toolbar branch.
2. Shell now knows About fragment targets; changing About section IDs requires coordinated shell tests.
3. Users at top of About lose explicit Return to menu btn. Toolbar brand remains route-home affordance; bottom back btn remains.
4. About no longer displays breadcrumb context. This is deliberate even though `/about` is not breadcrumb root.
5. Narrow users need one extra activation to reach section links.
6. Back-button coverage gains one named exception, increasing rule complexity. Any attempt to generalize exception requires another decision.

## Alternatives rejected

1. Keep internal sticky nav below breadcrumbs lost because it preserves stacked rows and prevents hero from touching toolbar.
2. Keep top back btn while removing breadcrumb lost because one extra row still separates hero from toolbar.
3. Make `/about` breadcrumb root lost because breadcrumb model is route hierarchy, while this exception is editorial presentation only.
4. Hide section nav on narrow screens lost because all four destinations must remain reachable.
5. Wrap four links into second toolbar row lost because variable toolbar height destabilizes sticky offsets and hero geometry.
