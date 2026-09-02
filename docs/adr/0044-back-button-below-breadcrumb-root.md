# Back Button Below The Breadcrumb Root

## Status

Accepted. Planned by T2 in artifacts/PLAN_2026_08_20_feedback-app-wide-round-6.md.

## Context

The rule was: every routed page carries a back button at the top and at the bottom
(`gones-back-button`, `position="top"` and `position="bottom"`), with explicit exceptions for auth
pages (top only) and About (bottom only). `src/app/shared/back-button-coverage.test.ts` enforces it by
reading every routed component's source.

The rule was written for the deep pages — a Tournament result four levels down genuinely needs a way
out at both ends of a long page. Applied uniformly, it also put a back button on the menu page, which
is where "back" goes. `/` rendered a button labelled "Back to previous", above a grid of the seven
destinations that button could plausibly mean.

`src/app/app-breadcrumbs.ts` already knows which pages those are. It returns a single-item breadcrumb
for exactly the pages that *start* a trail:

- `/` → `[{ label: menu }]`
- `/admin` → `[{ label: t('admin.title') }]`

Every other routed path returns two or more items, the first of which is a link.

## Decision

**A page that starts its breadcrumb carries no back button.**

- `/` (`features/menu/home-menu.component`) and `/admin` (`features/admin/admin-home.component`)
  render neither `position="top"` nor `position="bottom"`.
- Every routed page outside explicit exceptions keeps both, unchanged.
- The auth pages keep their existing exception: top only.
- `/about` keeps the bottom button only; its section navigation occupies the main header instead of a
  second row over the hero.
- `back-button-coverage.test.ts` holds breadcrumb-root and top-back-exception lists explicitly. It
  asserts root components contain no `gones-back-button`, About omits only the top button, and every
  other routed page keeps required coverage.
  `app-breadcrumbs.test.ts` pins that `/` and `/admin` are the only single-item breadcrumbs, so the
  two lists cannot drift apart silently.

The test is deliberately in two halves rather than one clever one: the coverage test parses component
sources, the breadcrumb test exercises the builder, and neither can express the other's assertion
honestly.

## Consequences

- `/` and `/admin` render no back controls. `/about` loses its top back control but retains the bottom
  one. All keep the toolbar brand link to `/`; About hides its breadcrumb row and moves section
  navigation into the main header.
- Adding a new route whose breadcrumb starts a trail means adding it to `BREADCRUMB_ROOT_COMPONENTS`
  as well as removing its back buttons; adding a bottom-only exception means updating
  `TOP_BACK_EXEMPT_COMPONENTS`. Coverage tests fail loudly until contract and component agree.
- The `gones-back-button` component itself is unchanged, including its `goBack()` fallback to
  `/leagues-archive` when there is no history.
- `AGENT.md` names breadcrumb roots, auth pages, and About as the three explicit exception classes.
