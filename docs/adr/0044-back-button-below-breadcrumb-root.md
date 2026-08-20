# Back Button Below The Breadcrumb Root

## Status

Proposed. Planned by T2 in `artifacts/PLAN_2026_08_20_feedback-app-wide-round-6.md`. Amends the
app-wide back-button rule recorded in `AGENT.md`.

## Context

The rule was: every routed page carries a back button at the top and at the bottom
(`gones-back-button`, `position="top"` and `position="bottom"`), with the auth pages as the single
exception, keeping the top one only. `src/app/shared/back-button-coverage.test.ts` enforced it by
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
- Every other routed page keeps both, unchanged.
- The auth pages keep their existing exception: top only.
- `back-button-coverage.test.ts` holds the breadcrumb-root list explicitly and asserts those
  components contain no `gones-back-button` at all, while every other routed page still has both.
  `app-breadcrumbs.test.ts` pins that `/` and `/admin` are the only single-item breadcrumbs, so the
  two lists cannot drift apart silently.

The test is deliberately in two halves rather than one clever one: the coverage test parses component
sources, the breadcrumb test exercises the builder, and neither can express the other's assertion
honestly.

## Consequences

- Two pages lose one navigation affordance each. Both keep the toolbar brand link to `/`, and the
  admin page keeps its breadcrumb, which is its own root and therefore not a link.
- Adding a new route whose breadcrumb starts a trail means adding it to `BREADCRUMB_ROOT_COMPONENTS`
  as well as removing its back buttons; the coverage test fails loudly until both are done.
- The `gones-back-button` component itself is unchanged, including its `goBack()` fallback to
  `/leagues-archive` when there is no history.
- `AGENT.md`'s back-button bullet now names two exceptions instead of one.
