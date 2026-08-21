import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../i18n/i18n.service';
import { ProposalApproverResponse } from '../../api/generated/gones-api';

export interface ApproverSelectionDialogData {
  approvers: ProposalApproverResponse[];
}

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title data-cy="approver-dialog-title">{{ i18n.t('proposal.dialogTitle') }}</h2>
    <mat-dialog-content data-cy="approver-dialog-content">
      <p data-cy="approver-dialog-help">{{ i18n.t('proposal.dialogHelp') }}</p>
      <fieldset class="approver-dialog-list" data-cy="approver-dialog-fieldset">
        @for (approver of data.approvers; track approver.id) {
          <label class="check-row" [attr.data-cy]="'approver-row-' + approver.id">
            <input type="checkbox" [attr.data-cy]="'approver-option-' + approver.id" [checked]="isChecked(approver.id)" (change)="toggle(approver.id)" />
            <span [attr.data-cy]="'approver-name-' + approver.id">{{ approver.username }}</span>
            <span class="chip" [attr.data-cy]="'approver-role-' + approver.id">{{ approver.globalRole }}</span>
          </label>
        }
      </fieldset>
    </mat-dialog-content>
    <mat-dialog-actions align="end" data-cy="approver-dialog-actions">
      <button mat-button type="button" data-cy="approver-dialog-cancel" (click)="cancel()">{{ i18n.t('common.cancelEsc') }}</button>
      <button mat-flat-button color="primary" type="button" data-cy="approver-dialog-submit" [disabled]="!selected().length" (click)="confirm()">{{ i18n.t('proposal.dialogSubmit') }}</button>
    </mat-dialog-actions>
  `
})
export class ApproverSelectionDialogComponent {
  readonly data = inject<ApproverSelectionDialogData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
  private readonly ref = inject<MatDialogRef<ApproverSelectionDialogComponent, string[] | undefined>>(MatDialogRef);
  private readonly checkedIds = signal<string[]>([]);
  readonly selected = computed(() => this.checkedIds());

  isChecked(id: string): boolean {
    return this.checkedIds().includes(id);
  }

  toggle(id: string): void {
    this.checkedIds.update(ids => ids.includes(id) ? ids.filter(existing => existing !== id) : [...ids, id]);
  }

  confirm(): void {
    if (!this.selected().length) return;
    this.ref.close(this.selected());
  }

  cancel(): void {
    this.ref.close(undefined);
  }
}
