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
  template: `<h2 mat-dialog-title>{{ data.title }}</h2><mat-dialog-content><mat-form-field appearance="outline" class="dialog-field"><mat-label>{{ data.label }}</mat-label><input matInput [(ngModel)]="value" cdkFocusInitial></mat-form-field></mat-dialog-content><mat-dialog-actions align="end"><button mat-button mat-dialog-close>{{ i18n.t('common.cancelEsc') }}</button><button mat-flat-button color="primary" [disabled]="!value.trim()" (click)="close()">{{ data.confirmLabel }}</button></mat-dialog-actions>`
})
export class TextPromptDialogComponent {
  readonly data = inject<TextPromptData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
  private readonly ref = inject<MatDialogRef<TextPromptDialogComponent, string>>(MatDialogRef);
  value = this.data.initialValue ?? '';
  close(): void { this.ref.close(this.value.trim()); }
}

@Component({
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  template: `<h2 mat-dialog-title>{{ data.title }}</h2><mat-dialog-content><p>{{ data.message }}</p></mat-dialog-content><mat-dialog-actions align="end"><button mat-button mat-dialog-close>{{ i18n.t('common.cancelEsc') }}</button><button mat-flat-button [color]="data.destructive ? 'warn' : 'primary'" [mat-dialog-close]="true" cdkFocusInitial>{{ data.confirmLabel }}</button></mat-dialog-actions>`
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
}
