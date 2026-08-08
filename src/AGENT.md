# Frontend AGENT contract

## Test identifiers

Every HTML element rendered by a component template MUST carry a `data-cy` attribute (`data-cy="..."` for static values, `[attr.data-cy]="..."` for computed ones). The value is a unique identifier for that element inside its component: kebab-case, prefixed with the feature (`settings-account-save`, `calendar-search-input`). Structural directives (`ng-container`, `ng-template`, `ng-content`) and inline SVG shape elements are exempt. Enforced by `src/app/shared/data-cy-coverage.test.ts`.

## Page titles

By default DO NOT add a kicker (`<p class="kicker">`) above a page title. Add one only when the page is a sub-page whose parent context is otherwise invisible.

## Component style

Standalone components, Signals, zoneless change detection, Angular Material, inline `template:` strings, i18n through `I18nService.t()` with keys added to BOTH the `en` and `fr` maps in `src/app/i18n/messages.ts`.
