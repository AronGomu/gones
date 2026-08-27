import '@angular/compiler';
import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, OrganizationUserLookupResponse } from '../../api/generated/gones-api';
import { OrganizerParticipantsComponent } from './organizer-participants.component';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — template assertions read the
// source, behaviour runs against Object.create instances. Precedent: my-registrations.component.test.ts.
const source = readFileSync(join(__dirname, 'organizer-participants.component.ts'), 'utf8');
const selectionPanel = source.slice(
  source.indexOf('data-cy="participant-selection"'),
  source.indexOf('data-cy="participant-add"')
);

describe('OrganizerParticipantsComponent lookup selection', () => {
  it('identifies the looked-up account by username alone', () => {
    expect(selectionPanel).not.toHaveLength(0);
    expect(selectionPanel).toContain('{{ user.username }}');
  });

  it('renders no email and no legal name for a looked-up account', () => {
    expect(selectionPanel).not.toContain('user.email');
    expect(selectionPanel).not.toContain('user.firstName');
    expect(selectionPanel).not.toContain('user.lastName');
  });

  it('adds the selected account with its userId alone', async () => {
    const register = vi.fn(() => of({ attemptId: 'attempt-1' }));
    const listParticipants = vi.fn(() => of({ items: [], page: 1, pageSize: 20, totalCount: 0 }));
    const component = Object.create(OrganizerParticipantsComponent.prototype) as OrganizerParticipantsComponent;
    Object.assign(component, {
      client: { registerEventParticipantByOrganizer: register, listPrivateEventParticipants: listParticipants },
      i18n: { t: (key: string) => key },
      eventId: 'event-1',
      selectedUser: signal<OrganizationUserLookupResponse | null>(null),
      participants: signal([]),
      participantPage: signal(1),
      participantTotal: signal(0),
      pageSize: 20,
      pending: signal(''),
      actionError: signal(''),
      status: signal('')
    });
    const user = { userId: 'user-1', username: 'new-user' } as OrganizationUserLookupResponse;

    await component.addParticipant(user);

    expect(register).toHaveBeenCalledWith('event-1', { userId: 'user-1' });
    expect(component.actionError()).toBe('');
    expect(component.selectedUser()).toBeNull();
  });

  // The lookup route is rate limited, so 429 is a reply the panel must survive: the organizer keeps
  // an error they can act on instead of a stale selection, and the form unlocks for the next try.
  // Throttling says nothing about the account, so it must not read as "no such User".
  it('reports a throttled lookup when the route answers 429', async () => {
    // The API boundary interceptor is what the component sees in the app: a problem+json 429 reaches
    // it as an ApiProblemError, not as the raw transport failure.
    const http = { request: () => throwError(() => new ApiProblemError(429, { code: 'rate_limited', message: 'Too many requests.' })) } as unknown as HttpClient;
    const component = Object.create(OrganizerParticipantsComponent.prototype) as OrganizerParticipantsComponent;
    Object.assign(component, {
      client: new Client(http),
      i18n: { t: (key: string) => key },
      event: signal({ organizationId: 'org-1' }),
      selectedUser: signal<OrganizationUserLookupResponse | null>({ userId: 'stale', username: 'stale' } as OrganizationUserLookupResponse),
      lookupError: signal(''),
      pending: signal(''),
      lookupKind: 'username',
      lookupValue: 'new-user'
    });

    await component.lookupUser();

    expect(component.lookupError()).toBe('participants.lookupThrottled');
    expect(component.selectedUser()).toBeNull();
    expect(component.pending()).toBe('');
  });
});
