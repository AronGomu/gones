import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { dataAuthority } from '../../config/data-authority';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-home" aria-labelledby="admin-title">
      <header class="page-heading" data-cy="admin-home-heading"><div data-cy="admin-home-heading-text"><p class="kicker" data-cy="admin-home-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-title" data-cy="admin-home-title">{{ i18n.t('admin.title') }}</h1></div></header>
      @if (!enabled) {
        <p class="error" role="alert" data-cy="admin-home-disabled">{{ i18n.t('admin.disabled') }}</p>
      } @else {
        <nav class="admin-nav" data-cy="admin-home-nav" [attr.aria-label]="i18n.t('admin.navAria')">
          <a mat-stroked-button routerLink="/admin/users" data-cy="admin-nav-users">{{ i18n.t('admin.users') }}</a>
          <a mat-stroked-button routerLink="/admin/organizations" data-cy="admin-nav-organizations">{{ i18n.t('admin.organizations') }}</a>
          <a mat-stroked-button routerLink="/admin/audit" data-cy="admin-nav-audit">{{ i18n.t('admin.audit') }}</a>
          <a mat-stroked-button routerLink="/admin/notifications/history" data-cy="admin-nav-notification-history">{{ i18n.t('admin.notificationHistory') }}</a>
          <a mat-stroked-button routerLink="/admin/notifications/dead-letters" data-cy="admin-nav-notification-dead-letters">{{ i18n.t('admin.notificationDeadLetters') }}</a>
          <a mat-stroked-button routerLink="/admin/events/deleted" data-cy="admin-nav-deleted-tournaments">{{ i18n.t('eventManage.deletedTitle') }}</a>
          <a mat-stroked-button routerLink="/organizations" data-cy="admin-nav-public-orgs">{{ i18n.t('org.publicList') }}</a>
        </nav>
      }
    </section>
  `
})
export class AdminHomeComponent {
  readonly i18n = inject(I18nService);
  readonly enabled = dataAuthority().adminV1;
}
