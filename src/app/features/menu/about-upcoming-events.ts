import { PublicEventView, sortEventsForList } from '../events/public-event-list';

export function selectUpcomingEvents(items: readonly PublicEventView[], now: Date): PublicEventView[] {
  const nowInstant = now.getTime();
  return sortEventsForList(items.filter(item => {
    const startsAt = item.startsAtUtc instanceof Date
      ? item.startsAtUtc.getTime()
      : typeof item.startsAtUtc === 'number'
        ? item.startsAtUtc
        : new Date(String(item.startsAtUtc)).getTime();
    return Number.isFinite(startsAt) && startsAt > nowInstant;
  })).slice(0, 3);
}
