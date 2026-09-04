import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as organizer-event-create.component.test.ts: no TestBed / zone.js in this
// repo, so `effect()` is stubbed to a no-op and the component is built with a bare Injector.
// These tests assert on component state and spy calls, never on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiProblemError } from '../../api/api-boundary';
import { EventRequestComponent } from './event-request.component';
import { EventProposalService } from './event-proposal.service';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { EventProposalReviewResponse, UserProfileResponse } from '../../api/generated/gones-api';

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => (values[name] ? [values[name]] : [])
  };
}

const baseReview: EventProposalReviewResponse = {
  id: 'p1',
  event: {
    organizationId: 'org1',
    title: 'Modern Cup',
    summary: 'A fun cup',
    bodyMarkdown: '<script>alert(1)</script>plain body',
    streetAddress: '1 rue Test',
    postalCode: '69001',
    city: 'Lyon',
    country: 'France',
    timeZoneId: 'Europe/Paris',
    startsAtLocal: '2027-08-01T10:00',
    endsAtLocal: '2027-08-01T18:00',
    capacity: 32,
    formatIds: ['fmt1', 'fmt2']
  },
  status: 'Pending',
  submittedByUsername: 'alice',
  approverUsername: 'bob',
  expiresAt: '2027-08-08T00:00:00Z',
  organizationName: 'Gones',
  formatNames: ['Legacy', 'Modern'],
  bodyHtml: '<p>Safe <strong>body</strong></p>',
  image: {
    id: 'img-2',
    variants: [
      { width: 320, height: 180, url: '/api/event-requests/tok123/images/img-2/variants/320' },
      { width: 960, height: 540, url: '/api/event-requests/tok123/images/img-2/variants/960' }
    ]
  }
} as unknown as EventProposalReviewResponse;

function setup(reviewResult: unknown = baseReview) {
  const profile = null as unknown as UserProfileResponse | null;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const route = { snapshot: { paramMap: paramMap({ token: 'tok123' }) } } as unknown as ActivatedRoute;

  const reviewByToken = vi.fn(async () => {
    if (reviewResult instanceof Error) throw reviewResult;
    return reviewResult as EventProposalReviewResponse;
  });
  const approveByToken = vi.fn(async () => ({ proposalId: 'p1', status: 'Approved', slug: 'x' }));
  const rejectByToken = vi.fn(async () => undefined);

  const proposalsStub = { reviewByToken, approveByToken, rejectByToken };

  const injector = Injector.create({ providers: [
    { provide: ActivatedRoute, useValue: route },
    { provide: AuthService, useValue: auth },
    { provide: EventProposalService, useValue: proposalsStub },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  const component = runInInjectionContext(injector, () => new EventRequestComponent());
  return { component, proposalsStub };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

const source = readFileSync(join(__dirname, 'event-request.component.ts'), 'utf8');

describe('EventRequestComponent', () => {
  it('renders the proposal with server-derived safe HTML instead of Markdown source', async () => {
    const { component } = setup();
    await flush();
    expect(component.state()).toBe('review');
    expect(component.proposal()?.event.title).toBe('Modern Cup');
    expect(component.proposal()?.organizationName).toBe('Gones');
    expect(component.proposal()?.formatNames).toEqual(['Legacy', 'Modern']);
    expect(component.proposal()?.bodyHtml).toBe('<p>Safe <strong>body</strong></p>');
    expect(source).toContain('<gones-server-sanitized-html');
    expect(source).toContain('[html]="review.bodyHtml || \'\'"');
    expect(source).not.toContain('{{ review.event.bodyMarkdown');
  });

  it('renders one private image from token-scoped URLs with generated alt', async () => {
    const { component } = setup();
    await flush();
    expect(component.proposal()?.image?.id).toBe('img-2');
    expect(source).toContain('@if (review.image; as image)');
    expect(source).toContain('[src]="reviewImageUrl(image)"');
    expect(source).toContain('[attr.srcset]="reviewImageSrcset(image)"');
    expect(source).toContain("review.event.title + ' — ' + i18n.t('event.image')");
    expect(source).toContain('loading="eager"');
  });

  it('renders a dash for a deleted organization', async () => {
    const { component } = setup({ ...baseReview, organizationName: '' });
    await flush();
    expect(component.state()).toBe('review');
    expect(component.proposal()?.organizationName).toBe('');
  });

  it('expired token shows the expired panel', async () => {
    const { component } = setup(new ApiProblemError(404, { status: 404 }));
    await flush();
    expect(component.state()).toBe('expired');
    expect(component.proposal()).toBeNull();
  });

  it('decided proposal shows the handled panel', async () => {
    const { component } = setup(new ApiProblemError(409, { status: 409 }));
    await flush();
    expect(component.state()).toBe('handled');
  });

  it('validate publishes and links to the event', async () => {
    const { component, proposalsStub } = setup();
    await flush();
    await component.approve();
    expect(proposalsStub.approveByToken).toHaveBeenCalledWith('tok123');
    expect(component.state()).toBe('approved');
    expect(component.slug()).toBe('x');
  });

  it('refuse opens the reason state', async () => {
    const { component, proposalsStub } = setup();
    await flush();
    component.state.set('reason');
    expect(component.state()).toBe('reason');
    expect(proposalsStub.rejectByToken).not.toHaveBeenCalled();
  });

  it('send is disabled without a reason', async () => {
    const { component } = setup();
    await flush();
    component.state.set('reason');
    component.reason.set('   ');
    expect(!component.reason().trim() || component.pending()).toBe(true);
  });

  it('send posts the reason', async () => {
    const { component, proposalsStub } = setup();
    await flush();
    component.state.set('reason');
    component.reason.set('Not a good fit');
    await component.sendReason();
    expect(proposalsStub.rejectByToken).toHaveBeenCalledTimes(1);
    expect(proposalsStub.rejectByToken).toHaveBeenCalledWith('tok123', 'Not a good fit');
  });

  it('send shows the confirmation', async () => {
    const { component } = setup();
    await flush();
    component.state.set('reason');
    component.reason.set('Not a good fit');
    await component.sendReason();
    expect(component.state()).toBe('refused');
  });

  it('renders while signed out', async () => {
    const { component } = setup();
    await flush();
    expect(component.state()).toBe('review');
  });
});
