import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthEntryComponent } from './auth-entry.component';
import { AuthService } from './auth.service';
import { I18nService } from '../i18n/i18n.service';
import { LastVisitedUrlService } from './last-visited-url.service';

function setup(returnUrl: string | null = null, mode = 'register') {
  const register = vi.fn(async () => ({ email: 'user@example.test', emailVerified: false }));
  const values: Record<string, string | null> = { returnUrl };
  const route = {
    snapshot: {
      data: { mode },
      queryParamMap: { get: (name: string) => values[name] ?? null }
    }
  };
  const navigate = vi.fn();
  const navigateByUrl = vi.fn();
  const injector = Injector.create({ providers: [
    { provide: I18nService, useValue: { t: (key: string) => key } },
    { provide: AuthService, useValue: { register } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: { navigate, navigateByUrl } },
    { provide: LastVisitedUrlService, useValue: { last: () => '' } }
  ] });
  const component = runInInjectionContext(injector, () => new AuthEntryComponent());
  return { component, register, navigate, navigateByUrl };
}

describe('AuthEntryComponent register password confirmation', () => {
  it('blocks submission and does not call the API on mismatch', async () => {
    const { component, register } = setup();
    component.password.set('aaaaaaaaaaaa');
    component.confirmPassword = 'b';

    await component.submitRegister();

    expect(register).not.toHaveBeenCalled();
    expect(component.fieldErrors()['confirmPassword']?.length).toBeGreaterThan(0);
  });

  it('sends a safe returnUrl and carries it to Verify Email', async () => {
    const returnUrl = '/calendar?view=list&register=lyon-legacy';
    const { component, register, navigate } = setup(returnUrl);
    component.password.set('aaaaaaaaaaaa');
    component.confirmPassword = 'aaaaaaaaaaaa';

    await component.submitRegister();

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ returnUrl }));
    expect(navigate).toHaveBeenCalledWith(['/verify-email'], { queryParams: { email: 'user@example.test', registered: 'true', returnUrl } });
  });

  it('drops an unsafe returnUrl from registration and follow-up navigation', async () => {
    const { component, register, navigate } = setup('https://evil.test/steal');
    component.password.set('aaaaaaaaaaaa');
    component.confirmPassword = 'aaaaaaaaaaaa';

    await component.submitRegister();

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ returnUrl: undefined }));
    expect(navigate.mock.calls[0][1].queryParams).not.toHaveProperty('returnUrl');
  });
});

describe('AuthEntryComponent returnUrl links', () => {
  const source = readFileSync(join(__dirname, 'auth-entry.component.ts'), 'utf8');

  it('carries safe returnUrl through login, register, and verify links', () => {
    for (const marker of ['login-register-link', 'register-login-link', 'verify-login-link']) {
      const index = source.indexOf(`data-cy="${marker}"`);
      const tag = source.slice(source.lastIndexOf('<a', index), source.indexOf('>', index));
      expect(tag).toContain('[queryParams]="returnQueryParams()"');
    }
  });
});
