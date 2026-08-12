# Session-Ready Route Guards

## Status

Proposed. Amends nothing; complements ADR 0029 (deterministic local development accounts) only in
that both concern how a session becomes usable.

## Context

`/registrations` was reported reachable while signed out. The route already carries `userGuard`, so
the guard was not missing — it was deciding on incomplete state.

Every guard in `src/app/auth/auth.guards.ts` is synchronous and reads `AuthService.profile()`, a
signal that starts `null` and is filled by `AuthService.bootstrap()`. Bootstrap runs from
`provideAppInitializer` in `src/main.ts` and swallows its own failures — `bootstrapped` is set in a
`finally` block. Any code path where a guard evaluates before that promise settles decides against a
null profile; any path where a stale profile survives a teardown decides against the wrong identity.
Reading an unsettled signal is the bug class, not one route's wiring.

Three fixes were possible: gate every guard on session readiness, add a second in-page assertion, or
let the API answer 401 and redirect from the error handler. The third leaves the page shell visible
to a signed-out visitor, which is what was observed and objected to.

## Decision

**Every auth guard awaits session readiness before deciding.** `AuthService` gains
`whenSessionReady(): Promise<void>`, which resolves immediately once `bootstrapped()` is true and
otherwise awaits the in-flight `bootstrap()` promise. `userGuard`, `organizerGuard`, `adminGuard`
and `verifiedEmailGuard` become async and await it first.

Redirect targets do not change: `/login?returnUrl=…`, `/?denied=…`, `/verify-email?email=…`.

Injection happens before the first `await`, because `inject()` is only valid in the synchronous part
of an injection context.

## Consequences

- Guarded routes wait for the startup refresh before rendering. Public routes are unaffected, so the
  first paint of the calendar is unchanged.
- The failure mode becomes uniform: an unresolved session redirects to sign-in, never renders a
  protected shell.
- Guards are now promise-returning, so guard unit tests must await the result.
- A regression Cypress spec, `cypress/e2e/auth-route-guards.cy.js`, pins the signed-out
  `/registrations` behaviour.
