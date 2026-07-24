import { spawnSync } from 'node:child_process';

for (const args of [
  ['compose', '--profile', 'development', 'down', '--volumes', '--remove-orphans'],
  ['compose', '--profile', 'development', 'up', '--build', '-d', '--wait']
]) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const seed = spawnSync(process.execPath, ['scripts/seed-local.mjs'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
console.log('Local stack reset to deterministic seeded state.');
