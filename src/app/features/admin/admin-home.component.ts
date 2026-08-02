import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-home" aria-labelledby="admin-title">
      <header class="page-heading"><div><p class="kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-title">{{ i18n.t('admin.title') }}</h1></div></header>
      @if (!enabled) {
        <p class="error" role="alert">{{ i18n.t('admin.disabled') }}</p>
      } @else {
        <nav class="admin-nav" [attr.aria-label]="i18n.t('admin.navAria')">
          <a mat-stroked-button routerLink="/admin/users" data-cy="admin-nav-users">{{ i18n.t('admin.users') }}</a>
          <a mat-stroked-button routerLink="/admin/organizations" data-cy="admin-nav-organizations">{{ i18n.t('admin.organizations') }}</a>
          <a mat-stroked-button routerLink="/admin/audit" data-cy="admin-nav-audit">{{ i18n.t('admin.audit') }}</a>
          <a mat-stroked-button routerLink="/organizations" data-cy="admin-nav-public-orgs">{{ i18n.t('org.publicList') }}</a>
        </nav>
      }
    </section>
  `
})
export class AdminHomeComponent {
  readonly i18n = inject(I18nService);
  readonly enabled = environment.features.adminV1;
}
