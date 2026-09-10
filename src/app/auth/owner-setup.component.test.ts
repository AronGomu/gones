import '@angular/compiler';
import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, filter } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, OwnerSetupRequest } from '../api/generated/gones-api';
import { ApiProblemError } from '../api/api-boundary';
import { I18nService } from '../i18n/i18n.service';
import { LastVisitedUrlService } from './last-visited-url.service';
import { OwnerSetupComponent } from './owner-setup.component';
import { BackButtonComponent } from '../shared/back-button.component';
import { FieldErrorsComponent } from './auth-entry.component';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

@Component({ standalone: true, template: '<p data-cy="owner-test-other">Other</p>' })
class OtherPage {}

@Component({ selector: 'gones-back-button', standalone: true, template: '<button type="button" data-cy="owner-test-back">Back</button>' })
class BackButtonStub {
  @Input() link?: readonly string[];
  @Input() label = '';
  @Input() position = 'top';
}

// Vitest esbuild does not emit Angular signal-input metadata; exercise owner wiring through JIT siblings.
@Component({ selector: 'gones-field-errors', standalone: true, template: '@for (message of messages ?? []; track message) { <p role="alert" data-cy="owner-test-field-error">{{ message }}</p> }' })
class FieldErrorsStub { @Input() messages?: string[]; }

const token = 'f'.repeat(43);

async function setup(fragment = `token=${token}`) {
  const response = new Subject<void>();
  const completeOwnerSetup = vi.fn((_request: OwnerSetupRequest) => response.asObservable());
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'owner-setup', component: OwnerSetupComponent }, { path: 'events', component: OtherPage }]),
      { provide: Client, useValue: { completeOwnerSetup } },
      { provide: I18nService, useValue: { t: (key: string) => key, language: () => 'en' } }
    ]
  });
  TestBed.overrideComponent(OwnerSetupComponent, { remove: { imports: [BackButtonComponent, FieldErrorsComponent] }, add: { imports: [BackButtonStub, FieldErrorsStub] } });
  const visited = TestBed.inject(LastVisitedUrlService);
  const router = TestBed.inject(Router);
  router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
    .subscribe(event => visited.record(event.urlAfterRedirects));
  const harness = await RouterTestingHarness.create('/events');
  history.replaceState(null, '', `/owner-setup#${fragment}`);
  const component = await harness.navigateByUrl(`/owner-setup${fragment ? '#' + fragment : ''}`, OwnerSetupComponent);
  const element = harness.routeNativeElement!;
  return { component, harness, element, response, completeOwnerSetup, visited };
}

function fill(component: OwnerSetupComponent): void {
  Object.assign(component.values, { username: 'OwnerFixture', firstName: 'Fixture', lastName: 'Owner', password: 'fixture-owner-chosen', confirmPassword: 'fixture-owner-chosen' });
}

describe('owner setup explicit confirmation DOM', () => {
  beforeEach(() => { TestBed.resetTestingModule(); history.replaceState(null, '', '/'); });

  it('loads without POST, scrubs browser fragment, preserves safe prior return URL', async () => {
    const { completeOwnerSetup, element, visited } = await setup();
    expect(completeOwnerSetup).not.toHaveBeenCalled();
    expect(location.hash).toBe('');
    expect(visited.last() === '/events').toBe(true);
    expect(element.querySelector<HTMLAnchorElement>('[data-cy="owner-login"]')!.getAttribute('href')).toBe('/login?returnUrl=%2Fadmin');
    expect(element.querySelectorAll('input')).toHaveLength(5);
    expect(element.querySelector('input[type="email"]')).toBeNull();
    expect(element.querySelectorAll('input[type="password"][autocomplete="new-password"]')).toHaveLength(2);
  });

  it('missing link shows recovery instructions without request or form', async () => {
    const { component, element, completeOwnerSetup } = await setup('');
    expect(element.querySelector('[data-cy="owner-invalid"][role="alert"]')).not.toBeNull();
    expect(element.querySelector('form')).toBeNull();
    await component.submit();
    expect(completeOwnerSetup).not.toHaveBeenCalled();
  });

  it('keeps password length validation on raw characters, without a composition rule', async () => {
    const { component } = await setup();
    fill(component);
    component.values.password = '  abcdefghij';
    component.values.confirmPassword = component.values.password;
    expect(component.valid()).toBe(true);
  });

  it('blocks mismatched confirmation before POST', async () => {
    const { component, completeOwnerSetup, harness, element } = await setup();
    fill(component);
    component.values.confirmPassword = 'different-fixture-value';
    await component.submit();
    harness.detectChanges();
    expect(completeOwnerSetup).not.toHaveBeenCalled();
    expect(element.querySelector('[data-cy="owner-confirm-password-error"]')!.textContent).toContain('auth.passwordMismatch');
  });

  it('DOM submit sends only setup fields, disables pending, clears credentials on success', async () => {
    const { component, harness, element, completeOwnerSetup, response } = await setup();
    fill(component);
    harness.detectChanges();
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    harness.detectChanges();
    expect(completeOwnerSetup).toHaveBeenCalledTimes(1);
    expect(Object.keys(completeOwnerSetup.mock.calls[0][0] as object).sort()).toEqual(['firstName', 'lastName', 'password', 'token', 'username']);
    expect(element.querySelector('fieldset')!.disabled).toBe(true);
    await component.submit();
    expect(completeOwnerSetup).toHaveBeenCalledTimes(1);
    response.next(); response.complete();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.completed()).toBe(true);
    expect(component.values.password).toBe('');
    expect(component.values.confirmPassword).toBe('');
    expect(component.hasToken()).toBe(false);
    expect(element.querySelector('[data-cy="owner-completed"][role="status"]')).not.toBeNull();
    expect(TestBed.inject(Router).url.startsWith('/owner-setup')).toBe(true);
  });

  it('renders backend validation accessibly, restores retry controls', async () => {
    const { component, harness, element, response } = await setup();
    fill(component);
    const submit = component.submit();
    response.error(new ApiProblemError(400, { errors: { Password: ['Password is too common.'] } }));
    await submit;
    harness.detectChanges();
    expect(component.pending()).toBe(false);
    expect(element.querySelector('fieldset')!.disabled).toBe(false);
    expect(element.querySelector('[data-cy="owner-password"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector('[data-cy="owner-password-error"]')!.textContent).toContain('Password is too common.');
    expect(element.querySelector('[data-cy="owner-error"][role="alert"]')).not.toBeNull();
  });
});
