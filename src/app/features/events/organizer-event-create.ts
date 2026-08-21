import { EventPayloadRequest, EventPreviewResponse } from '../../api/generated/gones-api';

export interface EventDraftValue {
  organizationId: string;
  title: string;
  summary: string;
  bodyHtml: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  timeZoneId: string;
  startsAtLocal: string;
  endsAtLocal: string;
  capacity: number | null;
  formatId: string;
  liveTournamentUrl: string;
  archiveTournamentUrl: string;
}

export function browserTimeZoneSuggestion(resolve = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try { return resolve() || ''; } catch { return ''; }
}

export function eventPayload(value: EventDraftValue): EventPayloadRequest {
  return {
    organizationId: value.organizationId,
    title: value.title.trim(),
    summary: optional(value.summary),
    bodyHtml: optional(value.bodyHtml),
    streetAddress: value.streetAddress.trim(),
    postalCode: optional(value.postalCode),
    city: value.city.trim(),
    country: value.country.trim(),
    timeZoneId: value.timeZoneId.trim(),
    startsAtLocal: value.startsAtLocal,
    endsAtLocal: value.endsAtLocal || undefined,
    capacity: value.capacity ?? undefined,
    formatIds: [value.formatId],
    liveTournamentUrl: optional(value.liveTournamentUrl),
    archiveTournamentUrl: optional(value.archiveTournamentUrl)
  };
}

export class PreviewPublicationState {
  preview?: EventPreviewResponse;
  private publishKey?: string;

  accept(preview: EventPreviewResponse): void {
    this.preview = preview;
    this.publishKey = undefined;
  }

  invalidate(): void {
    this.preview = undefined;
    this.publishKey = undefined;
  }

  idempotencyKey(create: () => string): string {
    this.publishKey ??= create();
    return this.publishKey;
  }
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}
