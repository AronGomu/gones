import { MessageKey, MessageParams, SettingsLanguage, translate } from './i18n/messages';

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
 * component's router/repository DI wiring. `t` and the lookup default to the app's French locale and
 * to a no-op resolver, so any branch not requiring a LiveTournament fetch can be called with just a
 * path. The archive branch resolves no name at all — see the comment on it.
 */
export async function buildBreadcrumbs(
  path: string,
  t: Translator = defaultTranslator('fr'),
  getLiveTournament: (liveTournamentId: string) => Promise<LiveTournamentNameLookup | null> = async () => null
): Promise<BreadcrumbItem[]> {
  const menu = t('nav.menu');
  const segments = path.split('/').filter(Boolean);
  if (!segments.length) return [{ label: menu }];
  if (segments[0] === 'about') return [{ label: menu, link: ['/'] }, { label: t('crumb.about'), lang: 'fr' }];
  if (segments[0] === 'events') {
    if (segments.length === 1) return [{ label: menu, link: ['/'] }, { label: t('crumb.calendar') }];
    const label = segments[1] === 'new' ? t('crumb.createEvent') : t('crumb.event');
    return [{ label: menu, link: ['/'] }, { label: t('crumb.calendar'), link: ['/events'] }, { label }];
  }
  if (segments[0] === 'settings') {
    if (segments[1] === 'account') return [{ label: menu, link: ['/'] }, { label: t('crumb.settings'), link: ['/settings'] }, { label: t('crumb.account') }];
    return [{ label: menu, link: ['/'] }, { label: t('crumb.settings') }];
  }
  if (segments[0] === 'registrations') return [{ label: menu, link: ['/'] }, { label: t('registration.myRegistrations') }];
  if (segments[0] === 'event-requests') return [{ label: menu, link: ['/'] }, { label: t('crumb.eventRequest') }];
  if (segments[0] === 'organizer' && segments[1] === 'events') return [{ label: menu, link: ['/'] }, { label: t('crumb.organizerEvents') }];
  if (segments[0] === 'admin') {
    const root = { label: t('admin.title'), link: ['/admin'] };
    if (!segments[1]) return [{ label: t('admin.title') }];
    if (segments[1] === 'users') return [root, { label: t('admin.users') }];
    if (segments[1] === 'organizations') return [root, { label: t('admin.organizations') }];
    if (segments[1] === 'audit') return [root, { label: t('admin.audit') }];
    if (segments[1] === 'notifications') return [root, { label: t(segments[2] === 'dead-letters' ? 'admin.notificationDeadLetters' : 'admin.notificationHistory') }];
    if (segments[1] === 'events' && segments[2] === 'deleted') return [root, { label: t('crumb.deletedEvents') }];
    return [root];
  }
  if (['login', 'register', 'verify-email', 'forgot-password', 'reset-password', 'auth'].includes(segments[0])) return [{ label: menu, link: ['/'] }, { label: t('auth.account') }];
  if (segments[0] === 'players') return [{ label: menu, link: ['/'] }, { label: t('crumb.player') }];
  if (segments[0] === 'global-stats') return [{ label: menu, link: ['/'] }, { label: t('crumb.globalStats') }];
  if (segments[0] === 'live-tournaments') {
    if (!segments[1]) return [{ label: menu, link: ['/'] }, { label: t('crumb.runningTournaments') }];
    const liveTournament = segments[1] === 'new' ? null : await getLiveTournament(decodeURIComponent(segments[1]));
    const label = segments[1] === 'new'
      ? t('crumb.newTournament')
      : t('crumb.liveSuffix', { name: liveTournament?.name || t('crumb.liveTournament') });
    return [{ label: menu, link: ['/'] }, { label: t('crumb.runningTournaments'), link: ['/live-tournaments'] }, { label }];
  }
  if (segments[0] === 'archive') {
    // Labels are static: resolving a Season or Tournament name here would mean new lookup plumbing
    // through AppComponent for a breadcrumb, and every one of these pages prints its own name.
    const root = { label: menu, link: ['/'] };
    const archive = { label: t('crumb.archive'), link: ['/archive/league-seasons'] };
    if (segments[1] === 'league-seasons' && segments[2]) return [root, archive, { label: t('crumb.season') }];
    if (segments[1] !== 'tournaments') return [root, { label: t('crumb.archive') }];
    if (!segments[2]) return [root, archive, { label: t('crumb.archiveTournaments') }];
    const tab = { label: t('crumb.archiveTournaments'), link: ['/archive/tournaments'] };
    const archivedTournamentId = decodeURIComponent(segments[2]);
    if (segments[3] === 'result') {
      return [root, archive, tab, { label: t('crumb.tournament'), link: ['/archive/tournaments', archivedTournamentId] }, { label: t('crumb.result') }];
    }
    return [root, archive, tab, { label: t('crumb.tournament') }];
  }
  return [{ label: menu, link: ['/'] }, { label: t('nav.notFound') }];
}
