# T4: Delete a running Live Tournament

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T1
**Commit outcome:** The advanced-settings dialog of a running Live Tournament ends with a red ghost Delete button that asks for confirmation and, on confirm, removes the tournament from whichever store backs it and returns the user to the Live Tournament list.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material).
- This slice: feedback line 3 — "In the advanced parameters of a running live tournament, there should be a button at the bottom of the advanced settings to delete the current live tournament. And of course, that button should be a red ghost-style button because it's a danger. And make sure to add a dialog to confirm the action."
- Out of scope here: the Live Tournament list page, the toolbar's advanced-settings trigger, any backend change, any change to the Live domain rules in `src/app/domain/live-tournament.ts`.
- Assumptions in force: none specific to this ticket.

### What already exists — do not rebuild it

The delete command is fully wired end to end; only the UI affordance is missing.

- `src/app/backend/application-backend.ts` line 83: `deleteLiveTournament(id: string, expectedVersion: number): Promise<void>;` on `LiveBackendPort`.
- `src/app/backend/aspnet-api-backend.service.ts` line 149: server implementation, sends the `If-Match` ETag.
- `src/app/backend/local-live-backend.service.ts` line 71: browser-local implementation, throws `LiveConcurrencyError` (status 412) on a version mismatch.
- `src/app/data/live-tournament-repository.service.ts` lines 26–30:
  ```ts
  async delete(id: string): Promise<void> {
    const existing = await this.backend.getLiveTournament(id);
    if (!existing) return;
    await this.backend.deleteLiveTournament(id, existing.documentVersion);
  }
  ```
  It re-reads the document to source the expected version, so the caller does not pass one.

Nothing in `src/**` calls `LiveTournamentRepository.delete` today. This ticket adds the only caller.

### The dialog to extend

`src/app/features/live-tournaments/live-tournament-runner.component.ts` (1028 lines) holds two components. The second, `LiveTournamentAdvancedSettingsDialogComponent`, starts at line 966. Its actions row today, lines 995–998:

```html
<mat-dialog-actions align="end" data-cy="live-advanced-actions">
  <button mat-button type="button" data-cy="live-advanced-cancel" (click)="close()">{{ i18n.t('common.cancel') }}</button>
  <button mat-flat-button class="home-primary-action" type="button" data-cy="live-advanced-apply" (click)="apply()">{{ i18n.t('live.applySettings') }}</button>
</mat-dialog-actions>
```

It closes with `LiveTournamentAdvancedSettingsDraft | undefined` (`Pick<LiveTournamentDocument, 'leagueId' | 'paidTrackingEnabled' | 'players'>`). The runner subscribes at line 674 and treats any falsy result as "cancelled".

**Therefore the close payload must become a discriminated union**, or a `delete` result would be mistaken for a settings draft. Widen it rather than smuggling a flag into the draft.

`LiveTournamentRunnerComponent` relevant members:
- `readonly tournament = signal<LiveTournamentDocument | null>(…)` — current document.
- `readonly canManage = computed(() => this.localMode || canManageLive(this.auth.profile()?.globalRole));` (line 250) and `readonly readOnly = computed(() => !this.canManage());` (line 251).
- `readonly pendingCommand = signal(false)` (line 242) — locks buttons while a structural command is in flight.
- `readonly error = signal('')`.
- injected as constructor params (line 273): `liveRepo: LiveTournamentRepository`, `leagueRepo: LeagueArchiveRepository`, `route: ActivatedRoute`, `router: Router`, `dialog: MatDialog`.
- `openAdvancedSettings()` at line 668 opens the dialog and applies the draft.

The confirm dialog to reuse is `ConfirmDialogComponent` from `src/app/shared/dialogs`, already imported by this file and used at line 662 via `firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title, message, confirmLabel, destructive } }).afterClosed())`. `destructive: true` renders the destructive styling — see `AppComponent.deleteLeague` in `src/app/app.component.ts` line 318 for the exact call shape.

The red ghost style class already exists in `src/styles.css` line 120: `.danger-ghost-action`. Use it on a `mat-stroked-button`; that is what the toolbar Log out button does.

Error classification helper: `liveCommandError(error)` from `src/app/data/live-command-ux.ts` returns `'forbidden' | 'stale' | 'failed'`.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`); every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`.

- **From Depends (T1):** a working local login (`admin@gones.test` / `test@gones.test`, password `Gones-dev-pass-123!`, seeded by `npm run dev`). Needed to validate the server-adapter path as an Admin and the browser-local path signed out.

## Requirements

- A Delete button sits at the **bottom** of the advanced-settings dialog, visually separated from Cancel/Apply.
- It is a `mat-stroked-button` carrying `class="danger-ghost-action"` — red outline, red label, transparent fill.
- Clicking it closes the settings dialog and opens a `ConfirmDialogComponent` with `destructive: true`. Cancelling there leaves the tournament untouched.
- Confirming calls `LiveTournamentRepository.delete(id)` and, on success, navigates to `/live-tournaments`.
- The button is hidden when `readOnly()` is true — a visitor who cannot manage the tournament cannot delete it.
- A failed delete leaves the user on the runner with a message: `'forbidden'` → `live.forbidden`-style copy, `'stale'` → reload-and-retry copy, anything else → generic failure copy.
- Works identically on both adapters. Nothing adapter-specific is added.

## Inputs

- `src/app/features/live-tournaments/live-tournament-runner.component.ts` — both components.
- `src/app/data/live-tournament-repository.service.ts` — `delete(id)`.
- `src/app/data/live-command-ux.ts` — `liveCommandError`.
- `src/app/shared/dialogs.ts` — `ConfirmDialogComponent` and its `data` contract.
- `src/app/i18n/messages.ts` — `en` map from line 5, `fr` map from line 1042.
- `cypress/e2e/live-local.cy.js` — the signed-out browser-local spec to extend.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/features/live-tournaments/live-tournament-delete.test.ts` first, covering the pure decision helper and the template contract. It fails because the helper and the button do not exist.
2. **Green** — add the helper, widen the dialog result type, add the button and the runner handler.
3. **Refactor** — only if needed. Keep green.

## Test plan

Extract the decision into a pure function so it is testable without a DOM or a TestBed, matching how `live-command-ux.ts` is already tested.

New pure function in `src/app/data/live-command-ux.ts`:

```ts
export type LiveDeleteOutcome = 'deleted' | 'cancelled' | 'forbidden' | 'stale' | 'failed';

/** Maps a delete attempt's result to the outcome the runner reports. */
export function liveDeleteOutcome(confirmed: boolean, error?: unknown): LiveDeleteOutcome {
  if (!confirmed) return 'cancelled';
  if (error === undefined) return 'deleted';
  return liveCommandError(error);
}
```

| Test | Input | Expect |
| --- | --- | --- |
| `a declined confirmation deletes nothing` | `liveDeleteOutcome(false)` | `'cancelled'` |
| `a confirmed delete with no error reports deleted` | `liveDeleteOutcome(true)` | `'deleted'` |
| `a 403 reports forbidden` | `liveDeleteOutcome(true, { status: 403 })` | `'forbidden'` |
| `a 412 reports stale` | `liveDeleteOutcome(true, { status: 412 })` | `'stale'` |
| `a local concurrency error reports stale` | `liveDeleteOutcome(true, new Error('staleLiveTournamentDocument'))` | `'stale'` |
| `anything else reports failed` | `liveDeleteOutcome(true, new Error('boom'))` | `'failed'` |
| `the dialog offers a red ghost delete button` | runner component source text | contains `data-cy="live-advanced-delete"` on a line that also contains `danger-ghost-action` and `mat-stroked-button` |
| `the delete button sits after the apply button` | runner component source text | the index of `live-advanced-delete` is greater than the index of `live-advanced-apply` |
| `the delete button is hidden for a read-only visitor` | runner component source text | `data-cy="live-advanced-delete"` appears inside an `@if (data.canManage) {` block |
| `deleting is confirmed before it happens` | runner component source text | `deleteTournament` body contains `ConfirmDialogComponent` and `destructive: true` |

Cypress (`cypress/e2e/live-local.cy.js`, new `it`): signed out, create a local tournament, open advanced settings, click delete, confirm, land back on `/live-tournaments` with the empty state, then reload and confirm it is still gone (proves the IndexedDB row was removed, not just the in-memory signal).

## Impl steps

- [ ] 1. Add `LiveDeleteOutcome` and `liveDeleteOutcome` to `src/app/data/live-command-ux.ts` exactly as written above.
- [ ] 2. Create `src/app/features/live-tournaments/live-tournament-delete.test.ts`. Start with `import '@angular/compiler';`. Import `liveDeleteOutcome` from `'../../data/live-command-ux'` and read the runner source with `readFileSync(join(__dirname, 'live-tournament-runner.component.ts'), 'utf8')`. Write all ten tests.
- [ ] 3. Run `npx vitest run src/app/features/live-tournaments/live-tournament-delete.test.ts` — the six pure tests pass, the four source tests fail.
- [ ] 4. In `src/app/i18n/messages.ts`, add to the `en` map next to the other `live.*` keys:
      ```
      'live.deleteTournament': 'Delete this tournament',
      'live.deleteConfirmTitle': 'Delete this running tournament?',
      'live.deleteConfirmMessage': 'This permanently removes “{name}” and every round and result it holds. This cannot be undone.',
      'live.deleteFailed': 'The tournament could not be deleted.',
      'live.deleteStale': 'The tournament changed elsewhere. Reload the page and try again.',
      ```
      Add the same five keys to the `fr` map:
      ```
      'live.deleteTournament': 'Supprimer ce tournoi',
      'live.deleteConfirmTitle': 'Supprimer ce tournoi en cours ?',
      'live.deleteConfirmMessage': 'Cette action supprime définitivement « {name} » ainsi que toutes ses rondes et tous ses résultats. Elle est irréversible.',
      'live.deleteFailed': 'Le tournoi n’a pas pu être supprimé.',
      'live.deleteStale': 'Le tournoi a changé ailleurs. Rechargez la page et réessayez.',
      ```
      Reuse the existing `live.forbidden` key for the forbidden case; if it does not exist, add `'live.forbidden': 'This account cannot manage running tournaments.'` / `'live.forbidden': 'Ce compte ne peut pas gérer les tournois en cours.'` in both maps.
- [ ] 5. In `live-tournament-runner.component.ts`, widen the dialog contract. Directly above `LiveTournamentAdvancedSettingsDialogComponent`, replace the draft type alias with:
      ```ts
      type LiveTournamentAdvancedSettingsDraft = Pick<LiveTournamentDocument, 'leagueId' | 'paidTrackingEnabled' | 'players'>;
      type LiveTournamentAdvancedSettingsResult =
        | { kind: 'apply'; draft: LiveTournamentAdvancedSettingsDraft }
        | { kind: 'delete' };
      ```
- [ ] 6. Add `canManage: boolean` to `LiveTournamentAdvancedSettingsDialogData` (the interface at line 959).
- [ ] 7. In the dialog component, change the `MatDialogRef` generic's result type to `LiveTournamentAdvancedSettingsResult`, and change `apply()` to close with `{ kind: 'apply', draft: { … } }` keeping the existing normalisation of `leagueId`, `paidTrackingEnabled` and `players`.
- [ ] 8. Add to the dialog component: `requestDelete(): void { this.dialogRef.close({ kind: 'delete' }); }`
- [ ] 9. In the dialog template, leave `mat-dialog-actions` exactly as it is and append a danger zone **below** it, as the last thing in the template. Material lays `mat-dialog-actions` out as a single row, so a delete button placed inside it would sit beside Apply, not at the bottom; its own block is what "at the bottom of the advanced settings" means and it is what keeps the source order the test asserts.
      ```html
      <mat-dialog-actions align="end" data-cy="live-advanced-actions">
        <button mat-button type="button" data-cy="live-advanced-cancel" (click)="close()">{{ i18n.t('common.cancel') }}</button>
        <button mat-flat-button class="home-primary-action" type="button" data-cy="live-advanced-apply" (click)="apply()">{{ i18n.t('live.applySettings') }}</button>
      </mat-dialog-actions>
      @if (data.canManage) {
        <div class="live-advanced-danger-zone" data-cy="live-advanced-danger-zone">
          <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="live-advanced-delete" (click)="requestDelete()">{{ i18n.t('live.deleteTournament') }}</button>
        </div>
      }
      ```
- [ ] 10. In `src/styles.css`, next to the other `live-advanced-*` rules, add:
      ```css
      .live-advanced-danger-zone { display: flex; justify-content: flex-start; padding: .35rem 1.5rem 1.25rem; border-top: 1px solid var(--soot); margin-top: .25rem; }
      ```
- [ ] 11. In `LiveTournamentRunnerComponent.openAdvancedSettings()`, pass `canManage: this.canManage()` in the dialog `data`, retype the generic to `LiveTournamentAdvancedSettingsResult`, and rewrite the subscription:
      ```ts
      .afterClosed().subscribe((result) => {
        if (!result) return;
        if (result.kind === 'delete') { void this.deleteTournament(); return; }
        const before = this.tournament();
        this.update((current) => this.withAutomaticRoundCount({ ...current, ...result.draft }));
        if (!before || this.tournament() === before) return;
        this.queueSettingsIntent();
        for (const player of result.draft.players) {
          const previous = before.players.find((item) => item.id === player.id);
          if (previous && previous.archetype !== player.archetype) this.queuePlayerEditIntent(player.id);
        }
      });
      ```
- [ ] 12. Add the handler to `LiveTournamentRunnerComponent`:
      ```ts
      async deleteTournament(): Promise<void> {
        const live = this.tournament();
        if (!live || this.readOnly() || this.pendingCommand()) return;
        const confirmed = Boolean(await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: this.i18n.t('live.deleteConfirmTitle'),
            message: this.i18n.t('live.deleteConfirmMessage', { name: live.name || this.i18n.t('liveList.liveTournament') }),
            confirmLabel: this.i18n.t('live.deleteTournament'),
            destructive: true
          }
        }).afterClosed()));
        if (!confirmed) return;
        this.pendingCommand.set(true);
        this.error.set('');
        try {
          await this.liveRepo.delete(live.id);
          await this.router.navigate(['/live-tournaments']);
        } catch (error) {
          logBoundaryError('live-tournament-runner.delete', error, { liveTournamentId: live.id });
          const outcome = liveDeleteOutcome(true, error);
          this.error.set(outcome === 'forbidden' ? this.i18n.t('live.forbidden') : outcome === 'stale' ? this.i18n.t('live.deleteStale') : this.i18n.t('live.deleteFailed'));
        } finally {
          this.pendingCommand.set(false);
        }
      }
      ```
      Add `liveDeleteOutcome` to the existing `live-command-ux` import; `logBoundaryError`, `firstValueFrom`, `ConfirmDialogComponent` and `MatDialog` are already imported in this file — verify before adding duplicates.
- [ ] 13. Add the Cypress case to `cypress/e2e/live-local.cy.js` as described in the Test plan. Follow the file's existing `visit()` helper and its `cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, … })` stub so the spec stays signed out and spends no auth permit. Open advanced settings through `[data-cy="live-tournament-advanced-settings-button"]` in the toolbar.
- [ ] 14. Run `npx vitest run src/app/features/live-tournaments/live-tournament-delete.test.ts src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- New: `src/app/features/live-tournaments/live-tournament-delete.test.ts`.
- Changed: `src/app/data/live-command-ux.ts` (+`LiveDeleteOutcome`, `liveDeleteOutcome`), `src/app/features/live-tournaments/live-tournament-runner.component.ts`, `src/styles.css`, `src/app/i18n/messages.ts`, `cypress/e2e/live-local.cy.js`.
- Public API: `LiveTournamentAdvancedSettingsDialogComponent` now closes with `{ kind: 'apply', draft } | { kind: 'delete' } | undefined` and requires `canManage: boolean` in its dialog data.
- New `data-cy` values: `live-advanced-danger-zone`, `live-advanced-delete`. New i18n keys: `live.deleteTournament`, `live.deleteConfirmTitle`, `live.deleteConfirmMessage`, `live.deleteFailed`, `live.deleteStale` (en + fr).

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npx cypress run --spec cypress/e2e/live-local.cy.js` passes
- [ ] Manual (browser-local): `npm run dev`, signed out, `/live-tournaments` → create → toolbar Advanced settings → the red ghost Delete is at the bottom → click → confirm dialog appears → Cancel leaves the tournament in place.
- [ ] Manual (browser-local): repeat and confirm → back on `/live-tournaments`, empty state, and the tournament is still gone after a reload.
- [ ] Manual (server): sign in as `admin@gones.test`, create a running tournament, delete it the same way — it disappears from the list and a second reload does not bring it back.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `feat(live): allow deleting a running tournament from advanced settings`
