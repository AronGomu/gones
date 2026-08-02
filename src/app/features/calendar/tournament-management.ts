import {
  PublicFormatResponse,
  TournamentManagementResponse,
  TournamentPreviewRenderResponse,
  UpdateTournamentDetailsRequest
} from '../../api/generated/gones-api';
import { TournamentDraftValue } from './organizer-tournament-create';

export type MajorTournamentField = 'start' | 'end' | 'timeZone' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'capacity' | 'formats';
export type ChangedTournamentField = 'title' | 'summary' | 'description' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'timeZone' | 'start' | 'end' | 'capacity' | 'formats' | 'status';

const defaultMajorLabels: Record<MajorTournamentField, string> = {
  start: 'start date/time',
  end: 'end date/time',
  timeZone: 'time zone',
  streetAddress: 'street address',
  postalCode: 'postal code',
  city: 'city',
  country: 'country',
  capacity: 'capacity',
  formats: 'formats'
};

export function managementToDraft(tournament: TournamentManagementResponse): TournamentDraftValue {
  return {
    organizationId: tournament.organizationId,
    title: tournament.title,
    summary: tournament.summary ?? '',
    bodyHtml: tournament.bodyHtml ?? '',
    streetAddress: tournament.streetAddress,
    postalCode: tournament.postalCode ?? '',
    city: tournament.city,
    country: tournament.country,
    timeZoneId: tournament.timeZoneId,
    startsAtLocal: localDateTime(tournament.venueStartDate, tournament.venueStartTime),
    endsAtLocal: localDateTime(tournament.venueEndDate, tournament.venueEndTime),
    capacity: tournament.capacity ?? null,
    formatIds: [...tournament.formatIds]
  };
}

export function tournamentUpdatePayload(value: TournamentDraftValue): UpdateTournamentDetailsRequest {
  return {
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

export function majorTournamentChanges(
  original: TournamentManagementResponse,
  draft: TournamentDraftValue,
  label: (field: MajorTournamentField) => string = field => defaultMajorLabels[field]
): string[] {
  const originalDraft = managementToDraft(original);
  const fields: Array<[MajorTournamentField, keyof TournamentDraftValue]> = [
    ['start', 'startsAtLocal'], ['end', 'endsAtLocal'], ['timeZone', 'timeZoneId'], ['streetAddress', 'streetAddress'],
    ['postalCode', 'postalCode'], ['city', 'city'], ['country', 'country'], ['capacity', 'capacity'], ['formats', 'formatIds']
  ];
  return fields.filter(([, key]) => !same(originalDraft[key], draft[key])).map(([field]) => label(field));
}

export function changedTournamentFields(
  original: TournamentManagementResponse,
  latest: TournamentManagementResponse,
  label: (field: ChangedTournamentField) => string = field => field
): string[] {
  const fields: Array<[ChangedTournamentField, keyof TournamentManagementResponse]> = [
    ['title', 'title'], ['summary', 'summary'], ['description', 'bodyHtml'], ['streetAddress', 'streetAddress'],
    ['postalCode', 'postalCode'], ['city', 'city'], ['country', 'country'], ['timeZone', 'timeZoneId'],
    ['start', 'startsAtUtc'], ['end', 'endsAtUtc'], ['capacity', 'capacity'], ['formats', 'formatIds'], ['status', 'status']
  ];
  return fields.filter(([, key]) => !same(original[key], latest[key])).map(([field]) => label(field));
}

export function canEditTournament(tournament: TournamentManagementResponse, now = new Date()): boolean {
  return !tournament.deletedAt && tournament.status === 'Published' && now.getTime() < new Date(String(tournament.startsAtUtc)).getTime();
}

export function canCancelTournament(tournament: TournamentManagementResponse): boolean {
  return !tournament.deletedAt && tournament.status !== 'Cancelled';
}

export function managementToDetail(
  tournament: TournamentManagementResponse,
  formats: readonly PublicFormatResponse[]
): TournamentPreviewRenderResponse {
  const byId = new Map(formats.map(format => [format.id, format]));
  return {
    title: tournament.title,
    slug: tournament.slug,
    summary: tournament.summary,
    bodyHtml: tournament.bodyHtml,
    venue: {
      streetAddress: tournament.streetAddress,
      postalCode: tournament.postalCode,
      city: tournament.city,
      country: tournament.country
    },
    timeZoneId: tournament.timeZoneId,
    venueStartDate: tournament.venueStartDate,
    venueStartTime: tournament.venueStartTime,
    venueEndDate: tournament.venueEndDate,
    venueEndTime: tournament.venueEndTime,
    startsAtUtc: tournament.startsAtUtc,
    endsAtUtc: tournament.endsAtUtc,
    capacity: tournament.capacity,
    status: tournament.status,
    organization: { id: tournament.organizationId, name: tournament.organizationName, description: undefined, website: undefined, contactEmail: undefined },
    formats: tournament.formatIds.map(id => byId.get(id) ?? { id, name: id, slug: id, sortOrder: 0 })
  };
}

function localDateTime(date: string, time: string): string {
  return `${date}T${time.slice(0, 5)}`;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function same(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? [...left].sort().join('\u0000') === [...right].sort().join('\u0000')
    : left === right;
}
