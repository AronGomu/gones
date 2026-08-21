import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthEntryComponent } from './auth-entry.component';
import { AuthService } from './auth.service';
import { I18nService } from '../i18n/i18n.service';
import { LastVisitedUrlService } from './last-visited-url.service';

function setup(returnUrl: string | null) {
  const login = vi.fn().mockResolvedValue(undefined);
  const navigateByUrl = vi.fn().mockResolvedValue(true);
  const route = {
    snapshot: {
      data: { mode: 'login' },
      queryParamMap: { get: (name: string) => name === 'returnUrl' ? returnUrl : null }
    }
  };
  const injector = Injector.create({ providers: [
    { provide: I18nService, useValue: { t: (key: string) => key } },
    { provide: AuthService, useValue: { login } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl } },
    { provide: LastVisitedUrlService, useValue: { last: () => '' } }
  ] });
  const component = runInInjectionContext(injector, () => new AuthEntryComponent());
  return { component, login, navigateByUrl };
}

describe('AuthEntryComponent login return URL', () => {
  it('returns to returnUrl after sign-in', async () => {
    const { component, navigateByUrl } = setup('/registrations');
    component.email.set('user@example.test');
    component.password.set('Password-1!');
    await component.submitLogin();
    expect(navigateByUrl).toHaveBeenCalledWith('/registrations');
  });
});
