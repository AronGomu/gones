import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface PasswordConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  passwordLabel: string;
}

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title data-cy="password-confirm-title">{{ data.title }}</h2>
    <mat-dialog-content data-cy="password-confirm-content">
      <p data-cy="password-confirm-message">{{ data.message }}</p>
      <label for="password-confirm-input" data-cy="password-confirm-label">{{ data.passwordLabel }}</label>
      <input id="password-confirm-input" type="password" autocomplete="current-password" data-cy="password-confirm-input" [(ngModel)]="password">
    </mat-dialog-content>
    <mat-dialog-actions data-cy="password-confirm-actions" align="end">
      <button mat-button type="button" data-cy="password-confirm-cancel" (click)="cancel()">Cancel</button>
      <button mat-flat-button type="button" class="danger-ghost-action" data-cy="password-confirm-submit" [disabled]="!password" (click)="confirm()">{{ data.confirmLabel }}</button>
    </mat-dialog-actions>
  `
})
export class PasswordConfirmDialogComponent {
  readonly data = inject<PasswordConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PasswordConfirmDialogComponent, string | undefined>>(MatDialogRef);
  password = '';

  cancel(): void {
    this.ref.close(undefined);
  }

  confirm(): void {
    if (!this.password) return;
    this.ref.close(this.password);
  }
}
