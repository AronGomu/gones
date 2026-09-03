# T5: Event draft persistence and leave guard

**Plan:** `./artifacts/PLAN_2026_09_03_create_edit_event_page.md`
**Depends:** T4
**Commit outcome:** Create restores latest account-scoped draft; create/edit warn before leaving changed data; successful writes clear correct state.

## Context (self-contained)

- C1 Goal: protect any entered Event info on browser/app navigation; restore latest create draft later; edit always starts from server.
- C2 This slice: pure draft codec/store, baseline comparison, Angular `CanDeactivateFn`, native `beforeunload`, resource-expiry restore.
- C3 Out of scope here: syncing draft across browsers/accounts, edit draft persistence, server draft rows, custom browser-native dialog text.
- C4 Assumptions in force: T2 stores manual address + IANA timezone with no provider claims; T3 Temporary image response expires at 24h + singular image.

## Requirements

- R1 Persist exactly one create draft per authenticated account at `gones.event-create.draft.<userId>` in `localStorage`.
- R2 Schema version 1; store durable form fields including `timeZoneId`, singular `EventImageUploadResponse`, `savedAt`, `userId`. Never store access token/secret.
- R3 Debounce writes 300ms after normalized create changes. Before browser unload, synchronously flush newest create state.
- R4 No age expiry. Successful direct publish or proposal submit removes matching account draft before navigation/success replacement.
- R5 Empty normalized create form removes key. Defaults/reference-populated organization + weekly Event Type alone do not count as user info and do not create dirty draft.
- R6 Restore only on `/events/new`. Account ID in payload must equal current profile ID + key suffix; malformed, unknown version, mismatched user → remove + ignore + log.
- R7 Restore manual address + `timeZoneId` as durable scalar input; backend catalog/server validation remains authoritative.
- R8 Restore valid Temporary image when `Date.now() < expiresAt`; uploader refetches variants as authenticated blobs. Expired/invalid image → omit image, retain other form data.
- R9 Edit `/organizer/events/:id/edit` never reads/writes/removes create draft. It always loads latest server Event + establishes baseline after canonical load.
- R10 Dirty comparison normalizes persisted fields + selected singular image ID. Exclude preview-collapse preference, loading/errors, idempotency key, retry counters, suggestion list.
- R11 Create baseline is empty-user-input shape after refs load or restored shape after restore. Edit baseline is canonical server shape after `applyCanonical`.
- R12 Any user change away from baseline activates guard; reverting exactly to baseline deactivates it. Successful save/publish/proposal resets baseline/dirty before route/success state.
- R13 Angular nav uses `CanDeactivateFn<OrganizerEventCreateComponent>` calling translated `ConfirmDialogComponent`. Cancel blocks Back button, browser history nav intercepted by router, router links, programmatic URL nav.
- R14 Native close/reload/address-bar/external nav uses `@HostListener('window:beforeunload')`; dirty calls `event.preventDefault()` + sets `event.returnValue = ''` for compatibility. Browser owns copy.
- R15 While submit/save is in flight, guard remains active. Only confirmed server success clears; failed write keeps draft/dirty.
- R16 Storage write/remove failure calls `logBoundaryError('event-create-draft.write'|'event-create-draft.remove', error, { userId })`; editor/publish remains functional.
- R17 Amend `src/app/backend/server-authority-boundary.test.ts` raw-`localStorage` allowlist with only `src/app/features/events/event-create-draft.ts`; comment states account-scoped unsent draft exception, never server authority/sync, retained across logout by confirmed design.
- R18 Route tests prove `canDeactivate` attached to both create + edit routes before wildcard matching.
- R19 Add EN + FR confirmation title/body/leave labels together; every dialog-triggering element keeps `data-cy` coverage.

## Inputs

- I1 `src/app/features/events/organizer-event-create.component.ts`
- I2 `src/app/features/events/organizer-event-create.ts`
- I3 new `src/app/features/events/event-create-draft.ts`
- I4 new `src/app/features/events/event-create-leave.guard.ts`
- I5 `src/app/app.routes.ts`
- I6 `src/app/shared/dialogs.ts` or actual `ConfirmDialogComponent` source resolved by import
- I7 `src/app/features/archive/tournament-detail.component.ts:475`
- I8 `src/app/features/settings/account-form.ts:47`
- I9 `src/app/shared/app-logger.ts`
- I10 `src/app/i18n/messages.ts`
- I11 `src/app/features/events/organizer-event-create.component.test.ts`
- I12 `src/app/features/events/event-image-uploader.component.ts`
- I13 `src/app/features/events/event-image-uploader.component.test.ts`
- I14 `src/app/backend/server-authority-boundary.test.ts`
- I15 `docs/adr/0055-account-scoped-event-create-drafts.md`
- I16 **From Depends T4:** cumulative T2–T4 editor shape: canonical country/location expiry, singular `imageId` + uploader response, finalized preview/publish template. T5 starts only after T4 to avoid shared-file writer collisions.

## Interface contract (level 5)

- P1 **Produces:** storage types:

```ts
export const EVENT_CREATE_DRAFT_KEY_PREFIX = 'gones.event-create.draft.';
export const EVENT_CREATE_DRAFT_VERSION = 1;

export interface StoredEventCreateDraftV1 {
  version: 1;
  userId: string;
  savedAt: string;
  value: EventDraftValueV1;
  image?: EventImageUploadResponse;
}

export interface EventDraftValueV1 {
  organizationId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
  timeZoneId: string;
  eventType: '' | 'weekly' | 'monthly' | 'major';
  startDate: string;
  startTime: string;
  capacity: number | null;
  formatId: string;
}
```

- P2 **Produces:** pure fns `eventCreateDraftKey(userId: string): string`, `parseEventCreateDraft(raw: string | null, userId: string, nowMs: number): RestoredEventCreateDraft | null`, `eventDraftIsDirty(baseline: EventDirtyShape, current: EventDirtyShape): boolean`, `eventCreateDraftIsEmpty(value: EventDraftValueV1, defaultOrganizationId: string): boolean`.
- P3 **Produces:** store service methods `read(userId)`, `write(draft)`, `remove(userId)`; catches/logs storage errors; no global `localStorage.clear()`.
- P4 **Produces:** component method `confirmLeave(): boolean | Observable<boolean> | Promise<boolean>` and route fn `eventEditorCanDeactivate: CanDeactivateFn<OrganizerEventCreateComponent>`.
- P5 **Consumes:** T2 manual address/timezone shape + T3 one upload response expiry/variants.
- P6 **Errors:** malformed/version/user mismatch storage → remove+log, return null; quota/security write fail → log, no throw; expired image → partial restore, no error banner.
- P7 **Invariants:** only owner account reads key; edit never touches storage; dirty resets only after server success/revert; canceled nav changes nothing; restored draft becomes baseline so immediate revisit does not prompt until changed.
- P8 **Produces:** uploader hydration entry point `restoreTemporaryImage(response: EventImageUploadResponse): void`; validates expiry, creates one card, calls existing authenticated blob fetch path, emits singular selection only after variants load.
- P9 **Integration links:** create form `src/app/features/events/organizer-event-create.component.ts:289` → 300ms codec/store → `localStorage` key → next create `ngOnInit` current `:374` restores after refs → uploader `restoreTemporaryImage` reloads auth blobs → route guard `src/app/app.routes.ts:24` calls component dialog → browser `beforeunload` flush/confirm → successful publish current `organizer-event-create.component.ts:596` removes key before `router.navigate`.

## TDD

1. **Red** — pure codec/dirty/store tests, component lifecycle tests, route guard tests, browser event tests first.
2. **Green** — min store/guard/component wiring.
3. **Refactor** — keep serialization + equality outside large component; no generic form persistence framework.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| Account scope | u1 draft then u2 visit | u2 sees no u1 data |
| No expiry | old valid scalar draft | restored |
| Malformed/version mismatch | bad JSON/v2 | removed, logged, blank form |
| Manual location | address + `Europe/Paris` | all six scalar fields restore |
| Image valid/expired | expiry around now | blob variants reload / image omitted |
| Empty/default form | refs populate org + weekly | no key, no dirty prompt |
| Debounce | rapid typing | one write after 300ms with latest value |
| Revert | change then baseline value | dirty false, no dialog |
| Create nav | dirty + cancel/confirm | blocked/allowed |
| Edit nav | canonical change + cancel/confirm | blocked/allowed; no local write |
| Native unload | dirty/clean | preventDefault+returnValue / untouched |
| Publish/proposal/save | success/failure | clear/reset only on success |
| Storage denied | `setItem` throws | logged; editor + publish continue |

## Impl steps

- [x] 1. Write red pure draft tests.
  - [x] 1.1 Pin v1 parse/account scope/malformed handling.
  - [x] 1.2 Pin durable manual location + image expiry degradation.
  - [x] 1.3 Pin normalized empty + baseline comparison.
- [x] 2. Write red route/component tests.
  - [x] 2.1 Pin create/edit `canDeactivate` coverage.
  - [x] 2.2 Pin translated dialog cancel/confirm.
  - [x] 2.3 Pin native unload + success reset.
- [x] 3. Implement one feature-specific draft module/store.
  - [x] 3.1 Debounced account-scoped writes.
  - [x] 3.2 Safe parse/partial restore.
  - [x] 3.3 Safe remove + structured logging.
  - [x] 3.4 Add deliberate server-authority allowlist exception + test rationale.
- [x] 4. Wire create lifecycle.
  - [x] 4.1 Restore after refs without marking dirty.
  - [x] 4.2 Restore manual location/timezone + rehydrate valid Temporary image previews.
  - [x] 4.3 Flush on unload; clear after publish/proposal success/empty.
- [x] 5. Wire baselines + leave guard for create/edit.
  - [x] 5.1 Establish mode-specific baseline.
  - [x] 5.2 Attach `CanDeactivateFn` to both routes.
  - [x] 5.3 Keep failed mutations dirty.
- [x] 6. Add EN/FR copy + route/data-cy assertions.

## Validation

- [x] V1 tests pass: `npm run test -- src/app/features/events/event-create-draft.test.ts src/app/features/events/event-create-leave.guard.test.ts src/app/features/events/organizer-event-create.component.test.ts src/app/features/events/organizer-event-create.test.ts src/app/features/events/event-image-uploader.component.test.ts src/app/backend/server-authority-boundary.test.ts src/app/data-mode-routes.test.ts`
- [x] V2 headless browser create: type, cancel leave, revisit `/events/new`, observe restore; publish removes matching draft.
- [x] V3 headless browser edit: change, cancel/confirm leave; revisit edit, observe server Event only; successful Save resets baseline in component test.
- [x] V4 headless browser: reload plus native `beforeunload` event semantics preserve dirty state; browser-owned dialog copy not asserted.
- [x] V5 no silent-failure swallow: storage catch logs exact boundary; expired resource degradation is specified/tested; navigation cancellation is user-selected, not swallowed.
- [x] V6 app functional: `npm run typecheck && npm run lint && npm run build`
- [x] V7 commit msg draft: `feat(events): preserve create drafts and guard unsaved edits`
