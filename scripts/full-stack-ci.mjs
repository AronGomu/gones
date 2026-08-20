import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// The API database is the single data authority (ADR 0020); there is no second profile to run.
const composeEnv = {
  ...process.env,
  GONES_FRONTEND_DATA_MODE: 'server',
  GONES_FEATURES__AUTH_V1: 'true',
  GONES_FEATURES__ADMIN_V1: 'true',
  GONES_FEATURES__CALENDAR_V1: 'true',
  GONES_FEATURES__LEAGUE_SERVER: 'true',
  GONES_FEATURES__LIVE_SERVER: 'true',
  GONES_AUTH_PROVIDER: 'Local',
  GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000',
  GONES_FRONTEND_API_BASE_URL: 'http://127.0.0.1:5080'
};
function run(args, env = composeEnv, allowFailure = false) {
  const result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit', env });
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1);
}

let cypressEnv;

function getCypressEnv() {
  if (cypressEnv) return cypressEnv;

  cypressEnv = { ...process.env };
  const result = spawnSync('nix', [
    'eval',
    '--raw',
    '--impure',
    '--expr',
    'with import <nixpkgs> {}; lib.makeLibraryPath [ glib gtk3 nss nspr dbus atk at-spi2-atk at-spi2-core cups cairo pango libx11 libxcomposite libxdamage libxext libxfixes libxrandr mesa libgbm expat libxcb libxkbcommon systemd alsa-lib ]'
  ], { encoding: 'utf8' });
  const cypressLibs = result.status === 0 ? result.stdout.trim() : '';
  if (cypressLibs) cypressEnv.LD_LIBRARY_PATH = `${cypressLibs}:${cypressEnv.LD_LIBRARY_PATH ?? ''}`;

  return cypressEnv;
}

function runCypress(spec) {
  const args = ['run', '--spec', spec, '--config', 'baseUrl=http://127.0.0.1:8081,screenshotOnRunFailure=false'];
  const env = getCypressEnv();
  return process.env.GONES_CYPRESS_BIN
    ? spawnSync(process.env.GONES_CYPRESS_BIN, args, { stdio: 'inherit', env })
    : spawnSync(process.execPath, [join('node_modules', 'cypress', 'bin', 'cypress'), ...args], { stdio: 'inherit', env });
}

try {
  run(['--profile', 'release', 'up', '--build', '-d', '--wait']);
  const smoke = spawnSync(process.execPath, ['scripts/smoke-full-stack.mjs', '--release'], { stdio: 'inherit' });
  if (smoke.status !== 0) process.exitCode = smoke.status ?? 1;
  if (!process.exitCode) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const authSeed = spawnSync(process.execPath, ['scripts/seed-auth-e2e.mjs'], { stdio: 'inherit', env: composeEnv });
      if (authSeed.status !== 0) {
        process.exitCode = authSeed.status ?? 1;
        break;
      }
    }
  }
  // Runs before every other spec: it is the only one that asserts on a browser that has never
  // visited the app, and `ops/e2e-spec-coverage.test.ts` keeps this list level with `cypress/e2e/`.
  if (!process.exitCode) {
    const firstVisit = runCypress('cypress/e2e/first-visit.cy.js');
    if (firstVisit.status !== 0) process.exitCode = firstVisit.status ?? 1;
  }
  if (!process.exitCode) {
    const powerUserGating = runCypress('cypress/e2e/power-user-gating.cy.js');
    if (powerUserGating.status !== 0) process.exitCode = powerUserGating.status ?? 1;
  }
  if (!process.exitCode) {
    const archiveStagedEdit = runCypress('cypress/e2e/archive-staged-edit.cy.js');
    if (archiveStagedEdit.status !== 0) process.exitCode = archiveStagedEdit.status ?? 1;
  }
  if (!process.exitCode) {
    const serverAuthority = runCypress('cypress/e2e/server-data-authority.cy.js');
    if (serverAuthority.status !== 0) process.exitCode = serverAuthority.status ?? 1;
  }
  if (!process.exitCode) {
    const calendarBrowser = runCypress('cypress/e2e/public-calendar.cy.js');
    if (calendarBrowser.status !== 0) process.exitCode = calendarBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const registrationBrowser = runCypress('cypress/e2e/event-registration.cy.js');
    if (registrationBrowser.status !== 0) process.exitCode = registrationBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const offlineBrowser = runCypress('cypress/e2e/offline-public-read.cy.js');
    if (offlineBrowser.status !== 0) process.exitCode = offlineBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const browser = runCypress('cypress/e2e/auth-profile.cy.js');
    if (browser.status !== 0) process.exitCode = browser.status ?? 1;
  }
  if (!process.exitCode) {
    const sessionBrowser = runCypress('cypress/e2e/auth-session-persistence.cy.js');
    if (sessionBrowser.status !== 0) process.exitCode = sessionBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const routeGuardBrowser = runCypress('cypress/e2e/auth-route-guards.cy.js');
    if (routeGuardBrowser.status !== 0) process.exitCode = routeGuardBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const leagueBrowser = runCypress('cypress/e2e/league-server.cy.js');
    if (leagueBrowser.status !== 0) process.exitCode = leagueBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const leagueLocalBrowser = runCypress('cypress/e2e/league-local.cy.js');
    if (leagueLocalBrowser.status !== 0) process.exitCode = leagueLocalBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const settingsBrowser = runCypress('cypress/e2e/settings-server.cy.js');
    if (settingsBrowser.status !== 0) process.exitCode = settingsBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const localSettingsBrowser = runCypress('cypress/e2e/settings-local.cy.js');
    if (localSettingsBrowser.status !== 0) process.exitCode = localSettingsBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const liveBrowser = runCypress('cypress/e2e/live-server.cy.js');
    if (liveBrowser.status !== 0) process.exitCode = liveBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const liveLocalBrowser = runCypress('cypress/e2e/live-local.cy.js');
    if (liveLocalBrowser.status !== 0) process.exitCode = liveLocalBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const adminBrowser = runCypress('cypress/e2e/admin-orgs.cy.js');
    if (adminBrowser.status !== 0) process.exitCode = adminBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const notificationBrowser = runCypress('cypress/e2e/admin-notification-delivery.cy.js');
    if (notificationBrowser.status !== 0) process.exitCode = notificationBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const organizerEventBrowser = runCypress('cypress/e2e/organizer-event-create.cy.js');
    if (organizerEventBrowser.status !== 0) process.exitCode = organizerEventBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const organizerEventManagementBrowser = runCypress('cypress/e2e/organizer-event-management.cy.js');
    if (organizerEventManagementBrowser.status !== 0) process.exitCode = organizerEventManagementBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const organizerParticipantsBrowser = runCypress('cypress/e2e/organizer-participants.cy.js');
    if (organizerParticipantsBrowser.status !== 0) process.exitCode = organizerParticipantsBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const abuseSurface = runCypress('cypress/e2e/abuse-surface.cy.js');
    if (abuseSurface.status !== 0) process.exitCode = abuseSurface.status ?? 1;
  }
  if (!process.exitCode) {
    const eventProposalBrowser = runCypress('cypress/e2e/event-proposal.cy.js');
    if (eventProposalBrowser.status !== 0) process.exitCode = eventProposalBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const accessibility = runCypress('cypress/e2e/accessibility.cy.js');
    if (accessibility.status !== 0) process.exitCode = accessibility.status ?? 1;
  }
  if (!process.exitCode) {
    const globalStats = runCypress('cypress/e2e/global-stats.cy.js');
    if (globalStats.status !== 0) process.exitCode = globalStats.status ?? 1;
  }
  if (!process.exitCode) {
    const playerStatLayout = runCypress('cypress/e2e/player-stat-layout.cy.js');
    if (playerStatLayout.status !== 0) process.exitCode = playerStatLayout.status ?? 1;
  }
  if (!process.exitCode) {
    const headerLayout = runCypress('cypress/e2e/header-layout.cy.js');
    if (headerLayout.status !== 0) process.exitCode = headerLayout.status ?? 1;
  }
  if (!process.exitCode) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const seed = spawnSync(process.execPath, ['scripts/seed-local.mjs'], { stdio: 'inherit' });
      if (seed.status !== 0) {
        process.exitCode = seed.status ?? 1;
        break;
      }
    }
  }
} finally {
  run(['--profile', 'release', 'down', '--volumes', '--remove-orphans'], composeEnv, true);
}
