# Use Cypress E2E and Jest Domain Tests for Local TDD

Status: superseded by [ADR 0015](./0015-use-vitest-cypress-and-basic-ci-for-angular.md) for the Angular migration.

Gones will use Cypress E2E tests for user-visible MVP behavior, optimized for local red-green-refactor development rather than CI. E2E tests should exercise behavior through the browser, run against a local static or dev server, and use stable `data-cy` selectors. Jest unit tests are allowed only for pure domain functions under `domain/`, where they can drive calculation, validation, import parsing, export/restore, and migration behavior without DOM or browser storage. Component tests and CI-oriented test infrastructure are intentionally deferred so implementation can proceed through vertical user-facing slices while keeping domain logic fast to test.
