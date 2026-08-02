import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const composeEnv = {
  ...process.env,
  GONES_FEATURES__AUTH_V1: 'true',
  GONES_FEATURES__ADMIN_V1: 'true',
  GONES_FEATURES__CALENDAR_V1: 'true',
  GONES_FEATURES__LEAGUE_SERVER: 'true',
  GONES_AUTH_PROVIDER: 'Local',
  GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000',
  GONES_FRONTEND_API_BASE_URL: 'http://127.0.0.1:5080'
};
const legacyComposeEnv = { ...composeEnv, GONES_FEATURES__AUTH_V1: 'false', GONES_FEATURES__ADMIN_V1: 'false', GONES_FEATURES__CALENDAR_V1: 'false', GONES_FEATURES__LEAGUE_SERVER: 'false' };

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
  run(['--profile', 'release', 'up', '--build', '-d', '--wait'], legacyComposeEnv);
  let smoke = spawnSync(process.execPath, ['scripts/smoke-full-stack.mjs', '--release'], { stdio: 'inherit' });
  if (smoke.status !== 0) process.exitCode = smoke.status ?? 1;
  if (!process.exitCode) {
    const browser = runCypress('cypress/e2e/local-static.cy.js');
    if (browser.status !== 0) process.exitCode = browser.status ?? 1;
  }
  if (!process.exitCode) {
    run(['--profile', 'release', 'up', '--build', '-d', '--wait']);
    smoke = spawnSync(process.execPath, ['scripts/smoke-full-stack.mjs', '--release'], { stdio: 'inherit' });
    if (smoke.status !== 0) process.exitCode = smoke.status ?? 1;
  }
  if (!process.exitCode) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const authSeed = spawnSync(process.execPath, ['scripts/seed-auth-e2e.mjs'], { stdio: 'inherit', env: composeEnv });
      if (authSeed.status !== 0) {
        process.exitCode = authSeed.status ?? 1;
        break;
      }
    }
  }
  if (!process.exitCode) {
    const calendarBrowser = runCypress('cypress/e2e/public-calendar.cy.js');
    if (calendarBrowser.status !== 0) process.exitCode = calendarBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const registrationBrowser = runCypress('cypress/e2e/tournament-registration.cy.js');
    if (registrationBrowser.status !== 0) process.exitCode = registrationBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const browser = runCypress('cypress/e2e/auth-profile.cy.js');
    if (browser.status !== 0) process.exitCode = browser.status ?? 1;
  }
  if (!process.exitCode) {
    const leagueBrowser = runCypress('cypress/e2e/league-server.cy.js');
    if (leagueBrowser.status !== 0) process.exitCode = leagueBrowser.status ?? 1;
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
    const organizerTournamentBrowser = runCypress('cypress/e2e/organizer-tournament-create.cy.js');
    if (organizerTournamentBrowser.status !== 0) process.exitCode = organizerTournamentBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const organizerTournamentManagementBrowser = runCypress('cypress/e2e/organizer-tournament-management.cy.js');
    if (organizerTournamentManagementBrowser.status !== 0) process.exitCode = organizerTournamentManagementBrowser.status ?? 1;
  }
  if (!process.exitCode) {
    const organizerParticipantsBrowser = runCypress('cypress/e2e/organizer-participants.cy.js');
    if (organizerParticipantsBrowser.status !== 0) process.exitCode = organizerParticipantsBrowser.status ?? 1;
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
