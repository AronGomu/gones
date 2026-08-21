import { BlockOrganizationUserRequest } from '../../api/generated/gones-api';
import { MessageKey } from '../../i18n/messages';

export type ParticipantLookupKind = 'username' | 'email';

export function lookupQuery(kind: ParticipantLookupKind, value: string): { username: string | undefined; email: string | undefined } {
  const exact = value.trim();
  if (!exact) throw new Error('lookup_required');
  return kind === 'username' ? { username: exact, email: undefined } : { username: undefined, email: exact };
}

export function blockPayload(userId: string, reason: string, expiresLocal: string): BlockOrganizationUserRequest {
  const exactReason = reason.trim();
  if (!exactReason) throw new Error('block_reason_required');
  return {
    userId,
    reason: exactReason,
    expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() as never : undefined
  };
}

export function participantErrorKey(status?: number, code?: string): MessageKey {
  if (status === 409 && code === 'event_full') return 'participants.capacityRace';
  if (status === 403 || status === 404) return 'participants.accessDenied';
  return 'participants.actionFailed';
}
