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

// Ordered on purpose. `first-visit.cy.js` runs before every other spec: it is the only one that
// asserts on a browser that has never visited the app. Each spec keeps its own cypress invocation,
// which is what keeps `testIsolation` honest. `ops/e2e-spec-coverage.test.ts` keeps this list level
// with `cypress/e2e/`.
const specs = [
  'cypress/e2e/first-visit.cy.js',
  'cypress/e2e/power-user-gating.cy.js',
  'cypress/e2e/archive-staged-edit.cy.js',
  'cypress/e2e/server-data-authority.cy.js',
  'cypress/e2e/public-calendar.cy.js',
  'cypress/e2e/event-registration.cy.js',
  'cypress/e2e/offline-public-read.cy.js',
  'cypress/e2e/auth-profile.cy.js',
  'cypress/e2e/auth-session-persistence.cy.js',
  'cypress/e2e/auth-route-guards.cy.js',
  'cypress/e2e/league-server.cy.js',
  'cypress/e2e/league-local.cy.js',
  'cypress/e2e/settings-server.cy.js',
  'cypress/e2e/settings-local.cy.js',
  'cypress/e2e/live-server.cy.js',
  'cypress/e2e/live-local.cy.js',
  'cypress/e2e/admin-orgs.cy.js',
  'cypress/e2e/admin-notification-delivery.cy.js',
  'cypress/e2e/organizer-event-create.cy.js',
  'cypress/e2e/organizer-event-management.cy.js',
  'cypress/e2e/organizer-participants.cy.js',
  'cypress/e2e/abuse-surface.cy.js',
  'cypress/e2e/event-proposal.cy.js',
  'cypress/e2e/accessibility.cy.js',
  'cypress/e2e/global-stats.cy.js',
  'cypress/e2e/player-stat-layout.cy.js',
  'cypress/e2e/header-layout.cy.js'
];

const specResults = [];

// Printed after the stack comes down, so the whole picture is the last thing in the log instead of
// something the reader has to scroll back through 27 cypress runs to reconstruct.
function printSpecSummary() {
  if (!specResults.length) return;
  const failed = specResults.filter(result => !result.ok);
  console.log(`\n=== e2e specs: ${specResults.length - failed.length}/${specResults.length} passed ===`);
  for (const result of specResults) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.spec}`);
  if (failed.length) console.log(`failing specs: ${failed.map(result => result.spec).join(' ')}`);
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
  // Not fail-fast: a failing spec must not hide the specs behind it. Failures accumulate into
  // `process.exitCode`, so the gate is still red at the end.
  if (!process.exitCode) {
    for (const spec of specs) {
      const result = runCypress(spec);
      specResults.push({ spec, ok: result.status === 0 });
      if (result.status !== 0) process.exitCode = result.status ?? 1;
    }
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
  printSpecSummary();
}
