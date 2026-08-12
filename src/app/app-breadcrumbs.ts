import { MessageKey, MessageParams, SettingsLanguage, translate } from './i18n/messages';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID, TournamentDocument } from './domain/models';

export interface BreadcrumbItem {
  label: string;
  link?: unknown[];
  lang?: string;
}

/** Minimal shape borrowed from LiveTournamentRepository.get() results — only the field this module reads. */
interface LiveTournamentNameLookup {
  name: string;
}

export type Translator = (key: MessageKey, params?: MessageParams) => string;

function defaultTranslator(language: SettingsLanguage): Translator {
  return (key, params) => translate(language, key, params);
}

/**
 * Pure(ish) breadcrumb builder, extracted from AppComponent so it can be exercised without the
 * component's router/repository DI wiring. `t` and the two lookups default to the app's French
 * locale and to no-op resolvers, so any branch not requiring a League/LiveTournament fetch can be
 * called with just a path.
 */
export async function buildBreadcrumbs(
  path: string,
  t: Translator = defaultTranslator('fr'),
  getLeague: (leagueId: string) => Promise<PersistedLeague | null> = async () => null,
  getLiveTournament: (liveTournamentId: string) => Promise<LiveTournamentNameLookup | null> = async () => null
): Promise<BreadcrumbItem[]> {
  const menu = t('nav.menu');
  const segments = path.split('/').filter(Boolean);
  if (!segments.length) return [{ label: menu }];
  if (segments[0] === 'about') return [{ label: menu, link: ['/'] }, { label: t('crumb.about'), lang: 'fr' }];
  if (segments[0] === 'calendar') {
    // Legacy `/calendar/tournaments/:slug` links redirect to `/events/:slug`; this crumb is only
    // ever seen for the instant before the redirect resolves.
    if (segments[1] === 'tournaments' && segments[2]) return [{ label: menu, link: ['/'] }, { label: t('crumb.calendar'), link: ['/calendar'] }, { label: t('crumb.tournament') }];
    return [{ label: menu, link: ['/'] }, { label: t('crumb.calendar') }];
  }
  if (segments[0] === 'events') {
    const label = segments[1] === 'new' ? t('crumb.createEvent') : t('crumb.event');
    return [{ label: menu, link: ['/'] }, { label: t('crumb.calendar'), link: ['/calendar'] }, { label }];
  }
  if (segments[0] === 'settings') {
    if (segments[1] === 'account') return [{ label: menu, link: ['/'] }, { label: t('crumb.settings'), link: ['/settings'] }, { label: t('crumb.account') }];
    return [{ label: menu, link: ['/'] }, { label: t('crumb.settings') }];
  }
  if (segments[0] === 'registrations') return [{ label: menu, link: ['/'] }, { label: t('registration.myRegistrations') }];
  if (segments[0] === 'event-requests') return [{ label: menu, link: ['/'] }, { label: t('crumb.eventRequest') }];
  if (segments[0] === 'organizer' && segments[1] === 'events') return [{ label: menu, link: ['/'] }, { label: t('crumb.organizerEvents') }];
  if (segments[0] === 'admin' && segments[1] === 'events' && segments[2] === 'deleted') return [{ label: menu, link: ['/'] }, { label: t('crumb.deletedEvents') }];
  if (['login', 'register', 'verify-email', 'forgot-password', 'reset-password', 'auth'].includes(segments[0])) return [{ label: menu, link: ['/'] }, { label: t('auth.account') }];
  if (segments[0] === 'players') return [{ label: menu, link: ['/'] }, { label: t('crumb.player') }];
  if (segments[0] === 'live-tournaments') {
    if (!segments[1]) return [{ label: menu, link: ['/'] }, { label: t('crumb.runningTournaments') }];
    const liveTournament = segments[1] === 'new' ? null : await getLiveTournament(decodeURIComponent(segments[1]));
    const label = segments[1] === 'new'
      ? t('crumb.newTournament')
      : t('crumb.liveSuffix', { name: liveTournament?.name || t('crumb.liveTournament') });
    return [{ label: menu, link: ['/'] }, { label: t('crumb.runningTournaments'), link: ['/live-tournaments'] }, { label }];
  }
  if (segments[0] !== 'leagues-archive') return [{ label: menu, link: ['/'] }, { label: t('nav.notFound') }];
  if (!segments[1]) return [{ label: menu, link: ['/'] }, { label: t('crumb.leagues') }];

  const leagueId = decodeURIComponent(segments[1]);
  const league = await getLeague(leagueId);
  const leagueLabel = league
    ? (league.id === PLACEHOLDER_LEAGUE_ID ? t('liveList.unassigned') : league.name)
    : t('crumb.league');
  if (segments[2] !== 'tournaments-archive' || !segments[3]) return [{ label: menu, link: ['/'] }, { label: t('crumb.leagues'), link: ['/leagues-archive'] }, { label: leagueLabel }];

  const tournamentId = decodeURIComponent(segments[3]);
  const tournamentLabel = league?.tournaments.find((item: TournamentDocument) => item.id === tournamentId)?.name || t('crumb.tournament');
  if (segments[4] === 'result') return [{ label: menu, link: ['/'] }, { label: t('crumb.leagues'), link: ['/leagues-archive'] }, { label: leagueLabel, link: ['/leagues-archive', leagueId] }, { label: tournamentLabel, link: ['/leagues-archive', leagueId, 'tournaments-archive', tournamentId] }, { label: t('crumb.result') }];
  return [{ label: menu, link: ['/'] }, { label: t('crumb.leagues'), link: ['/leagues-archive'] }, { label: leagueLabel, link: ['/leagues-archive', leagueId] }, { label: tournamentLabel }];
}
