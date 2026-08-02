import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MessageKey } from '../../i18n/messages';
import {
  Client,
  PublicTournamentParticipantListResponse,
  TournamentRegistrationCapabilityResponse,
  TournamentRegistrationListResponse,
  TournamentRegistrationMutationResponse
} from '../../api/generated/gones-api';

export const REGISTRATION_ONLINE = new InjectionToken<() => boolean>('REGISTRATION_ONLINE', {
  providedIn: 'root',
  factory: () => () => globalThis.navigator?.onLine !== false
});

export class RegistrationOfflineError extends Error {
  constructor() { super('registration_offline'); }
}

export function registrationErrorKey(code?: string): MessageKey {
  switch (code) {
    case 'email_verification_required': return 'registration.emailVerificationRequired';
    case 'registration_blocked': return 'registration.blocked';
    case 'tournament_full': return 'registration.full';
    case 'registration_closed':
    case 'unregistration_closed': return 'registration.started';
    case 'tournament_not_open': return 'registration.notOpen';
    case 'registration_already_active': return 'registration.alreadyActive';
    default: return 'registration.failed';
  }
}

@Injectable({ providedIn: 'root' })
export class TournamentRegistrationService {
  private readonly client = inject(Client);
  private readonly isOnline = inject(REGISTRATION_ONLINE);
  private readonly retryKeys = new Map<string, string>();

  participants(slug: string): Promise<PublicTournamentParticipantListResponse> {
    return firstValueFrom(this.client.participants(slug));
  }

  capability(tournamentId: string): Promise<TournamentRegistrationCapabilityResponse> {
    return firstValueFrom(this.client.getTournamentRegistrationCapability(tournamentId));
  }

  list(page = 1, pageSize = 100): Promise<TournamentRegistrationListResponse> {
    return firstValueFrom(this.client.listMyTournamentRegistrations(page, pageSize));
  }

  register(tournamentId: string): Promise<TournamentRegistrationMutationResponse> {
    return this.mutate('register', tournamentId, key => this.client.registerForTournament(tournamentId, key));
  }

  unregister(tournamentId: string): Promise<TournamentRegistrationMutationResponse> {
    return this.mutate('unregister', tournamentId, key => this.client.unregisterFromTournament(tournamentId, key));
  }

  private async mutate(
    command: 'register' | 'unregister',
    tournamentId: string,
    dispatch: (key: string) => ReturnType<Client['registerForTournament']>
  ): Promise<TournamentRegistrationMutationResponse> {
    if (!this.isOnline()) throw new RegistrationOfflineError();
    const operation = `${command}:${tournamentId}`;
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
