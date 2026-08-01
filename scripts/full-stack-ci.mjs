import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const composeEnv = {
  ...process.env,
  GONES_FEATURES__AUTH_V1: 'true',
  GONES_AUTH_PROVIDER: 'Local',
  GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000',
  GONES_FRONTEND_API_BASE_URL: 'http://127.0.0.1:5080'
};
const legacyComposeEnv = { ...composeEnv, GONES_FEATURES__AUTH_V1: 'false' };

function run(args, env = composeEnv, allowFailure = false) {
  const result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit', env });
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1);
}

function runCypress(spec) {
  const args = ['run', '--spec', spec, '--config', 'baseUrl=http://127.0.0.1:8081'];
  return process.env.GONES_CYPRESS_BIN
    ? spawnSync(process.env.GONES_CYPRESS_BIN, args, { stdio: 'inherit' })
    : spawnSync(process.execPath, [join('node_modules', 'cypress', 'bin', 'cypress'), ...args], { stdio: 'inherit' });
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
    const browser = runCypress('cypress/e2e/auth-profile.cy.js');
    if (browser.status !== 0) process.exitCode = browser.status ?? 1;
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
