import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../i18n/i18n.service';

export interface RegistrationSuccessData { title: string; }

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatDialogModule],
  template: `<h2 mat-dialog-title data-cy="registration-success-title">{{ i18n.t('registration.successTitle') }}</h2><mat-dialog-content data-cy="registration-success-content"><p data-cy="registration-success-message">{{ i18n.t('registration.successMessage', { title: data.title }) }}</p></mat-dialog-content><mat-dialog-actions align="end" data-cy="registration-success-actions"><button mat-button mat-dialog-close data-cy="registration-success-close" cdkFocusInitial>{{ i18n.t('common.close') }}</button><a mat-flat-button routerLink="/registrations" mat-dialog-close data-cy="registration-success-my-registrations">{{ i18n.t('registration.myRegistrations') }}</a></mat-dialog-actions>`
})
export class RegistrationSuccessDialogComponent {
  readonly data = inject<RegistrationSuccessData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
}
