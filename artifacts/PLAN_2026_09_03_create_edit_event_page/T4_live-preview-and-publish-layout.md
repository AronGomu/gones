# T4: Live preview and publish layout

**Plan:** `./artifacts/PLAN_2026_09_03_create_edit_event_page.md`
**Depends:** T3
**Commit outcome:** Live/public Event detail + editor layout update instantly and expose requested preview, drop-zone, and Publish UX.

## Context (self-contained)

- C1 Goal: fix live Event name, show Event Type before players, repair sticky preview/header, center drop-zone text, make Publish full-width green with error tooltip.
- C2 This slice: shared detail view + create-page template/CSS/i18n + UI tests.
- C3 Out of scope here: location retry/country select, image API migration, draft persistence/leave guard.
- C4 Assumptions in force: T3 supplies singular nullable `image`; actual `EventDetailViewComponent` remains shared by local preview + public detail.

## Requirements

- R1 Draft `displayTitle`: trimmed title alone when no format; `${format.name} — ${title}` when both exist; placeholder only when title empty.
- R2 Shared hero topline shows organization, translated Event Type, player count in that order on same row. Event Type values map `weekly|monthly|major` through existing i18n keys.
- R3 Event Type + player count render in live preview and public detail because shared component owns them.
- R4 Live preview gets header row inside `<aside>`: larger left-aligned `<h2>` + right-aligned Hide Preview button.
- R5 Remove create-mode preview toggle from page heading. Show Preview remains reachable when collapsed via same preview-header/control region or collapsed placeholder row; preserve `aria-controls`, `aria-expanded`, session collapse key.
- R6 Desktop preview outer aside is sticky below toolbar + breadcrumb: `top: calc(var(--app-toolbar-height) + 3.75rem)` plus 1rem breathing space if computed breadcrumb height requires it. Header never scrolls.
- R7 Put only detail body in inner `.event-live-preview__scroll`; `max-height: calc(100dvh - stickyOffset)`; `overflow:auto`. Header stays outside inner scroll.
- R8 Live Preview title uses clear h2 scale (`clamp(1.5rem, 2vw, 2rem)`), margin 0, text-align left.
- R9 Publish action spans form section: actions container + button width 100%. Existing `home-primary-action`/success token remains green.
- R10 Tooltip lists every current error in stable form order: organization, title, summary, description (`bodyMarkdown`), format, Event Type, capacity, country, region, street, postal code, city, date, time, location resolution, image, general.
- R11 Tooltip works while Publish disabled: attach `matTooltip` to focusable wrapper, not disabled native button. Wrapper has `tabindex="0"` only when errors exist, `aria-describedby` to hidden text, hover + keyboard focus.
- R12 Tooltip is empty/disabled when no errors. On first hover/focus, mark controls touched or derive validation without mutating touched state; do not submit.
- R13 Center drag/drop prompt text + picker control horizontally/vertically inside drop zone; retain keyboard file input access.
- R14 Add/adjust every rendered element `data-cy`; EN/FR tooltip/error labels together; no unrelated restyle.

## Inputs

- I1 `src/app/features/events/organizer-event-create.component.ts`
- I2 `src/app/features/events/organizer-event-create.component.test.ts`
- I3 `src/app/features/events/organizer-event-create.test.ts`
- I4 `src/app/features/events/event-detail-view.component.ts`
- I5 `src/app/features/events/event-detail-view.component.test.ts`
- I6 `src/app/features/events/event-image-uploader.component.ts`
- I7 `src/app/i18n/messages.ts`
- I8 `src/styles.css`
- I9 `cypress/e2e/organizer-event-management.cy.js`
- I10 `cypress/e2e/public-calendar.cy.js`
- I11 **From Depends:** T3 leaves `EventDetailView.image?: EventImageResponse`, one-image uploader/card, no gallery/order/alt controls.

## Interface contract (level 5)

- P1 **Produces:** `eventTypeLabel = computed(() => eventType ? i18n.t('event.type.' + eventType) : draft placeholder/empty)`.
- P2 **Produces:** `publishErrors(): readonly string[]` in exact field order; duplicate identical messages collapse by first occurrence; tooltip string joins with `\n`.
- P3 **Produces:** DOM hooks `event-live-preview-header`, `event-live-preview-title`, `event-preview-collapse`, `event-live-preview-scroll`, `event-publish-tooltip`, `event-publish-errors`.
- P4 **Consumes:** T3 singular `event.image`; shared detail props unchanged otherwise.
- P5 **Errors:** no new API errors. Disabled Publish reason is fully represented by tooltip when invalid; loading-only disable may use translated pending message rather than field error.
- P6 **Invariants:** local preview performs no HTTP; public/detail parity stays one component; title changes update same change-detection turn; preview header always visible while detail inner area scrolls.
- P7 **Integration links:** form `valueChanges` `src/app/features/events/organizer-event-create.component.ts:374` → `previewRevision` → `draftPreview` current `:329` → `gones-event-detail-view` current `:215` → shared hero `src/app/features/events/event-detail-view.component.ts:39` → public host `src/app/features/events/public-event-detail.component.ts:35`.

## TDD

1. **Red** — add exact state/DOM/Cypress tests for title fallback, Event Type order, preview sticky header, full-width green action, tooltip, centered drop zone.
2. **Green** — minimal template/computed/CSS changes.
3. **Refactor** — extract error-list pure fn only if component test needs it; keep shared detail reuse.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| Draft title no format | title `Night Cup`, format empty | preview title `Night Cup` live |
| Draft title + format | Legacy + Night Cup | `Legacy — Night Cup` |
| Hero order | weekly, 32 | organization → Weekly → 32 players same row |
| Public parity | public detail payload | same type/count ordering |
| Sticky scroll | long preview, desktop | header + Hide visible; detail scrolls; no toolbar clipping |
| Collapse | Hide then Show | state/session/ARIA preserved; control remains reachable |
| Publish errors | each invalid control including `bodyMarkdown` + combined invalid form | disabled button; hover/focus wrapper shows every unique ordered error |
| Valid publish | valid form | tooltip absent; full-width green button enabled |
| Drop zone | desktop/mobile | prompt/control centered; keyboard file picker usable |
| Accessibility | component DOM | axe no basic violations; every element has `data-cy` |

## Impl steps

- [x] 1. Write red title/type/detail tests. Evidence: focused Vitest run failed on missing no-format title, `eventTypeLabel`, and shared Event Type DOM.
  - [x] 1.1 Pin no-format title fallback. Evidence: `expected '' to be 'Instant Cup'`.
  - [x] 1.2 Pin translated Event Type before player count in shared topline. Evidence: `eventTypeLabel is not a function` and missing `event-detail-event-type`.
- [x] 2. Write red editor layout/tooltip/drop-zone tests. Evidence: focused Vitest run failed 7 tests / passed 68 before implementation.
  - [x] 2.1 Pin preview header DOM + sticky inner scroll CSS. Evidence: missing `event-live-preview-header` failure.
  - [x] 2.2 Pin full-width success Publish + all-error tooltip keyboard access. Evidence: missing `MatTooltipModule` and `publishErrors` failures.
  - [x] 2.3 Pin centered drop-zone layout. Evidence: computed drop-zone display was `block`, expected `flex`.
- [x] 3. Implement draft title + shared detail topline. Evidence: focused title/type/detail tests pass.
- [x] 4. Restructure preview aside. Evidence: focused preview DOM/CSS contract test passes.
  - [x] 4.1 Move toggle into preview header. Evidence: `event-live-preview-header` contains `event-preview-collapse`.
  - [x] 4.2 Split sticky outer/header from scrollable inner detail. Evidence: `event-live-preview-scroll` follows header; CSS owns overflow.
  - [x] 4.3 Use toolbar/breadcrumb-aware top offset. Evidence: CSS pins exact `calc(var(--app-toolbar-height) + 3.75rem)`.
- [x] 5. Implement Publish wrapper/error summary. Evidence: focused component/state tests pass.
  - [x] 5.1 Import `MatTooltipModule`. Evidence: template contract test passes.
  - [x] 5.2 Derive stable translated error list. Evidence: exact 17-error French ordered-list test passes without touching controls.
  - [x] 5.3 Apply full-width success CSS. Evidence: source/CSS contract test pins `create-action-button` plus 100% widths.
- [x] 6. Center singular uploader drop-zone contents. Evidence: rendered DOM computed-style test passes with flex center and enabled labeled file input.
- [x] 7. Add EN/FR copy + `data-cy`; run DOM/visual checks. Evidence: bilingual message-map build passed; targeted release-stack Cypress passed 10/10 with axe, 375/1023/1024 layout, keyboard tooltip, sticky scroll, collapse, and uploader geometry.

## Validation

- [x] V1 tests pass: `npm run test -- src/app/features/events/organizer-event-create.component.test.ts src/app/features/events/organizer-event-create.test.ts src/app/features/events/event-detail-view.component.test.ts src/app/features/events/event-image-uploader.component.test.ts` → 75 passed.
- [x] V2 Cypress full stack (script owns spec list; args unsupported): `COMPOSE_FILE=compose.yaml:.tmp/compose-cypress-T4.yaml COMPOSE_PROJECT_NAME=gones-t4 npm run cy:run` → 26/26 specs passed; isolated dev port 14200 avoided unrelated PID 255286 on 4200.
- [x] V3 headless browser check at 375/1023/1024px: title updates without format; preview header stays outside inner scroll; keyboard tooltip opens; Publish spans form; targeted Cypress 10/10 passed.
- [x] V4 no silent-failure swallow on path added: `none` (derived UI only).
- [x] V5 app functional: `npm run typecheck && npm run lint && npm run build` passed; build emitted only two pre-existing unused `RouterLink` warnings in admin components.
- [x] V6 commit: `feat(events): keep live preview controls and publish errors visible` (`bcc1e9b`).

## Cumulative review closure (2026-09-04)

- [x] R1 Publish summary retains every distinct field-labelled error in ticket order; dedupe applies only to exact final labelled strings. Loading, pending, and no-organization disables expose translated general reasons through focusable tooltip wrapper. Evidence: focused frontend run → 211/211 passed; full `npm run test` → 2272/2272 passed.
