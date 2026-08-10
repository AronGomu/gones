import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthEntryComponent } from './auth-entry.component';
import { AuthService } from './auth.service';
import { I18nService } from '../i18n/i18n.service';
import { LastVisitedUrlService } from './last-visited-url.service';

/**
 * The login gate is three computed signals on the component, not the pure predicate underneath:
 * `loginValid` drives `[disabled]` on the submit, and `emailInvalid` / `passwordInvalid` decide
 * whether a validity message is rendered at all. `login-validation.test.ts` covers the predicate and
 * pins the template bindings as source strings, which leaves the wiring itself untested — dropping
 * the pristine guards or widening `loginValid` to the email alone keeps that suite green. These
 * tests drive the component the way `auth-entry.register.test.ts` does: no TestBed, a bare Injector
 * and `runInInjectionContext`.
 */
function setup() {
  const route = {
    snapshot: {
      data: { mode: 'login' },
      queryParamMap: { get: () => null }
    }
  };
  const injector = Injector.create({ providers: [
    { provide: I18nService, useValue: { t: (key: string) => key } },
    { provide: AuthService, useValue: { login: vi.fn() } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
    { provide: LastVisitedUrlService, useValue: { last: () => '' } }
  ] });
  return runInInjectionContext(injector, () => new AuthEntryComponent());
}

describe('AuthEntryComponent login gate', () => {
  it('a pristine empty form is invalid and says nothing about it', () => {
    const component = setup();

    expect(component.email()).toBe('');
    expect(component.password()).toBe('');
    expect(component.loginValid()).toBe(false);
    // Both validity messages are rendered under these flags, so "no message on a pristine form" is
    // exactly "both flags are false".
    expect(component.emailInvalid()).toBe(false);
    expect(component.passwordInvalid()).toBe(false);
  });

  it('an empty password keeps the submit disabled even with a valid email', () => {
    const component = setup();
    component.email.set('admin@gones.test');

    expect(component.loginValid()).toBe(false);
    expect(component.passwordInvalid()).toBe(false);
  });

  it('a two-character password keeps the submit disabled and reports itself', () => {
    const component = setup();
    component.email.set('admin@gones.test');
    component.password.set('ab');

    expect(component.loginValid()).toBe(false);
    expect(component.passwordInvalid()).toBe(true);
    expect(component.emailInvalid()).toBe(false);
  });

  it('a three-character password with a valid email enables the submit', () => {
    const component = setup();
    component.email.set('admin@gones.test');
    component.password.set('abc');

    expect(component.loginValid()).toBe(true);
    expect(component.emailInvalid()).toBe(false);
    expect(component.passwordInvalid()).toBe(false);
  });

  it('a malformed address is reported and blocks the submit however long the password is', () => {
    const component = setup();
    component.email.set('admin@localhost');
    component.password.set('abcdef');

    expect(component.loginValid()).toBe(false);
    expect(component.emailInvalid()).toBe(true);
    expect(component.passwordInvalid()).toBe(false);
  });
});
