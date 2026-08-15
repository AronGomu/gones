import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SessionScopeService } from '../../auth/session-scope.service';
import { MessageKey } from '../../i18n/messages';
import { OnlineStatusService } from '../../shared/online-status.service';
import {
  Client,
  PublicEventParticipantListResponse,
  EventRegistrationCapabilityResponse,
  EventRegistrationListResponse,
  EventRegistrationMutationResponse
} from '../../api/generated/gones-api';

export const REGISTRATION_ONLINE = new InjectionToken<() => boolean>('REGISTRATION_ONLINE', {
  providedIn: 'root',
  factory: () => {
    const status = inject(OnlineStatusService);
    return () => status.isOnline();
  }
});

export class RegistrationOfflineError extends Error {
  constructor() { super('registration_offline'); }
}

export function registrationErrorKey(code?: string): MessageKey {
  switch (code) {
    case 'email_verification_required': return 'registration.emailVerificationRequired';
    case 'registration_blocked': return 'registration.blocked';
    case 'event_full': return 'registration.full';
    case 'registration_closed':
    case 'unregistration_closed': return 'registration.started';
    case 'event_not_open': return 'registration.notOpen';
    case 'registration_already_active': return 'registration.alreadyActive';
    default: return 'registration.failed';
  }
}

@Injectable({ providedIn: 'root' })
export class EventRegistrationService {
  private readonly client = inject(Client);
  private readonly isOnline = inject(REGISTRATION_ONLINE);
  /** Idempotency keys are session-scoped: a new user must never replay the previous one. */
  private readonly retryKeys = new Map<string, string>();

  constructor() {
    inject(SessionScopeService).register(() => this.retryKeys.clear());
  }

  participants(slug: string): Promise<PublicEventParticipantListResponse> {
    return firstValueFrom(this.client.participants(slug));
  }

  capability(eventId: string): Promise<EventRegistrationCapabilityResponse> {
    return firstValueFrom(this.client.getEventRegistrationCapability(eventId));
  }

  list(page = 1, pageSize = 100): Promise<EventRegistrationListResponse> {
    return firstValueFrom(this.client.listMyEventRegistrations(page, pageSize));
  }

  register(eventId: string): Promise<EventRegistrationMutationResponse> {
    return this.mutate('register', eventId, key => this.client.registerForEvent(eventId, key));
  }

  unregister(eventId: string): Promise<EventRegistrationMutationResponse> {
    return this.mutate('unregister', eventId, key => this.client.unregisterFromEvent(eventId, key));
  }

  private async mutate(
    command: 'register' | 'unregister',
    eventId: string,
    dispatch: (key: string) => ReturnType<Client['registerForEvent']>
  ): Promise<EventRegistrationMutationResponse> {
    if (!this.isOnline()) throw new RegistrationOfflineError();
    const operation = `${command}:${eventId}`;
    const key = this.retryKeys.get(operation) ?? globalThis.crypto.randomUUID();
    this.retryKeys.set(operation, key);
    try {
      const response = await firstValueFrom(dispatch(key));
      this.retryKeys.delete(operation);
      return response;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse && error.status === 0)) this.retryKeys.delete(operation);
      throw error;
    }
  }
}
