import { describe, expect, it } from 'vitest';
import { blockPayload, lookupQuery, participantErrorKey } from './participant-management';

describe('Organizer participant management contracts', () => {
  it('builds exact verified-User lookup without free-form participant PII', () => {
    expect(lookupQuery('username', '  Alice_01  ')).toEqual({ username: 'Alice_01', email: undefined });
    expect(lookupQuery('email', '  alice@example.test ')).toEqual({ username: undefined, email: 'alice@example.test' });
    expect(() => lookupQuery('username', '   ')).toThrow('lookup_required');
  });

  it('builds organization-wide block scope with optional UTC expiry', () => {
    expect(blockPayload('user-1', '  repeated abuse  ', '2030-01-02T10:30')).toEqual({
      userId: 'user-1', reason: 'repeated abuse', expiresAt: new Date('2030-01-02T10:30').toISOString()
    });
    expect(blockPayload('user-1', 'abuse', '')).toEqual({ userId: 'user-1', reason: 'abuse', expiresAt: undefined });
    expect(() => blockPayload('user-1', '   ', '')).toThrow('block_reason_required');
  });

  it('maps capacity races separately from generic failures', () => {
    expect(participantErrorKey(409, 'event_full')).toBe('participants.capacityRace');
    expect(participantErrorKey(404, 'not_found')).toBe('participants.accessDenied');
    expect(participantErrorKey(503, undefined)).toBe('participants.actionFailed');
  });
});
