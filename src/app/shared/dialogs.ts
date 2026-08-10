import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { I18nService } from '../i18n/i18n.service';

export interface TextPromptData { title: string; label: string; confirmLabel: string; initialValue?: string; }
export interface ConfirmData { title: string; message: string; confirmLabel: string; destructive?: boolean; }

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `<h2 mat-dialog-title data-cy="text-prompt-dialog-title">{{ data.title }}</h2><form data-cy="text-prompt-dialog-form" (ngSubmit)="close()"><mat-dialog-content data-cy="text-prompt-dialog-content"><mat-form-field appearance="outline" class="dialog-field" data-cy="text-prompt-dialog-field"><mat-label data-cy="text-prompt-dialog-label">{{ data.label }}</mat-label><input matInput name="value" data-cy="text-prompt-dialog-input" [(ngModel)]="value" cdkFocusInitial></mat-form-field></mat-dialog-content><mat-dialog-actions align="end" data-cy="text-prompt-dialog-actions"><button mat-button type="button" mat-dialog-close data-cy="text-prompt-dialog-cancel">{{ i18n.t('common.cancelEsc') }}</button><button mat-flat-button color="primary" type="submit" data-cy="text-prompt-dialog-confirm" [disabled]="!value.trim()">{{ data.confirmLabel }}</button></mat-dialog-actions></form>`
})
export class TextPromptDialogComponent {
  readonly data = inject<TextPromptData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
  private readonly ref = inject<MatDialogRef<TextPromptDialogComponent, string>>(MatDialogRef);
  value = this.data.initialValue ?? '';
  close(): void {
    const value = this.value.trim();
    if (!value) return;
    this.ref.close(value);
  }
}

@Component({
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  template: `<h2 mat-dialog-title data-cy="confirm-dialog-title">{{ data.title }}</h2><mat-dialog-content data-cy="confirm-dialog-content"><p data-cy="confirm-dialog-message">{{ data.message }}</p></mat-dialog-content><mat-dialog-actions align="end" data-cy="confirm-dialog-actions"><button mat-button mat-dialog-close data-cy="confirm-dialog-cancel">{{ i18n.t('common.cancelEsc') }}</button><button mat-flat-button data-cy="confirm-dialog-confirm" [color]="data.destructive ? 'warn' : 'primary'" [mat-dialog-close]="true" cdkFocusInitial>{{ data.confirmLabel }}</button></mat-dialog-actions>`
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
}
