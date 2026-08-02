import { TournamentPayloadRequest, TournamentPreviewResponse } from '../../api/generated/gones-api';

export interface TournamentDraftValue {
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
  formatIds: string[];
}

export function browserTimeZoneSuggestion(resolve = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try { return resolve() || ''; } catch { return ''; }
}

export function tournamentPayload(value: TournamentDraftValue): TournamentPayloadRequest {
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
    formatIds: [...value.formatIds]
  };
}

export class PreviewPublicationState {
  preview?: TournamentPreviewResponse;
  private publishKey?: string;

  accept(preview: TournamentPreviewResponse): void {
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
