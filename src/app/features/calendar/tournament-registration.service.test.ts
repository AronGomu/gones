import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '../../api/generated/gones-api';
import { SessionScopeService } from '../../auth/session-scope.service';
import { REGISTRATION_ONLINE, RegistrationOfflineError, TournamentRegistrationService, registrationErrorKey } from './tournament-registration.service';

describe('TournamentRegistrationService', () => {
  it('keeps one Idempotency-Key through network retry then rotates after success', async () => {
    const registerForTournament = vi.fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })))
      .mockReturnValueOnce(of({ attemptId: 'attempt', tournamentId: 'tournament', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }))
      .mockReturnValueOnce(of({ attemptId: 'attempt-2', tournamentId: 'tournament', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }));
    const service = createService({ registerForTournament });

    await expect(service.register('tournament')).rejects.toBeInstanceOf(HttpErrorResponse);
    await expect(service.register('tournament')).resolves.toMatchObject({ status: 'Confirmed' });
    await expect(service.register('tournament')).resolves.toMatchObject({ status: 'Confirmed' });

    expect(registerForTournament.mock.calls[0][1]).toBe(registerForTournament.mock.calls[1][1]);
    expect(registerForTournament.mock.calls[2][1]).not.toBe(registerForTournament.mock.calls[1][1]);
  });

  it('rejects offline writes before dispatch without optimistic state', async () => {
    const registerForTournament = vi.fn();
    const service = createService({ registerForTournament }, false);

    await expect(service.register('tournament')).rejects.toBeInstanceOf(RegistrationOfflineError);
    expect(registerForTournament).not.toHaveBeenCalled();
  });

  it('drops in-flight idempotency keys when the session ends', async () => {
    const registerForTournament = vi.fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })))
      .mockReturnValueOnce(of({ attemptId: 'attempt', tournamentId: 'tournament', userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' }));
    const sessionScope = new SessionScopeService();
    const service = createService({ registerForTournament }, true, sessionScope);

    await expect(service.register('tournament')).rejects.toBeInstanceOf(HttpErrorResponse);
    sessionScope.clear();
    await expect(service.register('tournament')).resolves.toMatchObject({ status: 'Confirmed' });

    expect(registerForTournament.mock.calls[1][1]).not.toBe(registerForTournament.mock.calls[0][1]);
  });

  it('maps stable server reasons to specific UX copy', () => {
    expect(registrationErrorKey('email_verification_required')).toBe('registration.emailVerificationRequired');
    expect(registrationErrorKey('registration_blocked')).toBe('registration.blocked');
    expect(registrationErrorKey('tournament_full')).toBe('registration.full');
    expect(registrationErrorKey('registration_closed')).toBe('registration.started');
    expect(registrationErrorKey('unknown')).toBe('registration.failed');
  });
});

function createService(client: Partial<Client>, online = true, sessionScope = new SessionScopeService()): TournamentRegistrationService {
  const injector = Injector.create({ providers: [
    TournamentRegistrationService,
    { provide: Client, useValue: client },
    { provide: SessionScopeService, useValue: sessionScope },
    { provide: REGISTRATION_ONLINE, useValue: () => online }
  ] });
  return injector.get(TournamentRegistrationService);
}
