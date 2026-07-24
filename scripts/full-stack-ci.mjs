import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function run(args, allowFailure = false) {
  const result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit' });
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1);
}

try {
  run(['--profile', 'release', 'up', '--build', '-d', '--wait']);
  const smoke = spawnSync(process.execPath, ['scripts/smoke-full-stack.mjs', '--release'], { stdio: 'inherit' });
  if (smoke.status !== 0) process.exitCode = smoke.status ?? 1;
  if (!process.exitCode) {
    const cypressCli = join('node_modules', 'cypress', 'bin', 'cypress');
    const browser = spawnSync(process.execPath, [cypressCli, 'run', '--spec', 'cypress/e2e/local-static.cy.js', '--config', 'baseUrl=http://127.0.0.1:8081'], { stdio: 'inherit' });
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
  run(['--profile', 'release', 'down', '--volumes', '--remove-orphans'], true);
}
