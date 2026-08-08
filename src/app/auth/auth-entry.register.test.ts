import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthEntryComponent } from './auth-entry.component';
import { AuthService } from './auth.service';
import { I18nService } from '../i18n/i18n.service';
import { LastVisitedUrlService } from './last-visited-url.service';

function setup() {
  const register = vi.fn();
  const route = {
    snapshot: {
      data: { mode: 'register' },
      queryParamMap: { get: () => null }
    }
  };
  const injector = Injector.create({ providers: [
    { provide: I18nService, useValue: { t: (key: string) => key } },
    { provide: AuthService, useValue: { register } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
    { provide: LastVisitedUrlService, useValue: { last: () => '' } }
  ] });
  const component = runInInjectionContext(injector, () => new AuthEntryComponent());
  return { component, register };
}

describe('AuthEntryComponent register password confirmation', () => {
  it('blocks submission and does not call the API on mismatch', async () => {
    const { component, register } = setup();
    component.password = 'aaaaaaaaaaaa';
    component.confirmPassword = 'b';

    await component.submitRegister();

    expect(register).not.toHaveBeenCalled();
    expect(component.fieldErrors()['confirmPassword']?.length).toBeGreaterThan(0);
  });
});
