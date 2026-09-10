// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scripts = ['release-rehearsal.mjs', 'backup-restore-rehearsal.mjs'];
const names = ['api', 'worker', 'migrator', 'backup', 'frontend'];
const manifest = () => ({ images: names.map((name, index) => ({ name, digest: `sha256:${String(index + 1).repeat(64)}` })) });
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type Call = { command: string; args: string[]; env: Record<string, string> };
function rehearsal(script: string, input: unknown, reuse = true, failAt = 'up') {
  mkdirSync('.tmp', { recursive: true });
  const directory = mkdtempSync(resolve('.tmp/rehearsal-reuse-'));
  directories.push(directory);
  mkdirSync(join(directory, 'reports/images'), { recursive: true });
  if (input !== undefined) writeFileSync(join(directory, 'reports/images/manifest.json'), typeof input === 'string' ? input : JSON.stringify(input));
  const log = join(directory, 'calls.jsonl');
  const preload = join(directory, 'docker-boundary.mjs');
  writeFileSync(preload, `
import childProcess from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import https from 'node:https';
import { EventEmitter } from 'node:events';
let started = false;
https.request = (url, options, receive) => {
  const call = new EventEmitter();
  call.end = () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
    receive(response);
    response.emit('data', Buffer.from(url.endsWith('/runtime-config.json')
      ? JSON.stringify({ dataMode: 'server', apiBaseUrl: 'https://localhost:8443' }) : '<gones-root>'));
    response.emit('end');
  };
  return call;
};
childProcess.spawnSync = (command, args, options = {}) => {
  const env = Object.fromEntries(Object.entries(options.env ?? process.env)
    .filter(([name]) => name.startsWith('GONES_IMAGE_') || ['GONES_COMPOSE_FILE', 'COMPOSE_PROJECT_NAME'].includes(name)));
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command, args, env }) + '\\n');
  if (args.includes('scripts/smoke-migration.mjs')) throw new Error('migration smoke boundary observed');
  if (command !== 'docker') throw new Error('Unexpected subprocess: ' + command);
  if (args.includes(${JSON.stringify(failAt)})) return { status: 67, stdout: '', stderr: 'injected Docker failure' };
  if (args.includes('backup') && args.includes('run')) throw new Error('backup boundary observed');
  if (args.includes('up')) {
    started = true;
    mkdirSync('.release-test-export', { recursive: true });
    writeFileSync('.release-test-export/ca.pem', 'test CA handled by HTTPS boundary double');
  }
  if (args.includes('down')) started = false;
  let stdout = args.includes('psql') ? '1\\n' : '';
  if (args[0] === 'volume' && args[1] === 'ls' && started) stdout = 'postgres-volume\\nimage-volume';
  if (args[0] === 'volume' && args[1] === 'inspect') stdout = JSON.stringify(['postgres-data', 'event-image-data']
    .map((name) => ({ Name: name, Labels: { 'com.docker.compose.volume': name } })));
  if (args.includes('ps')) stdout = 'container-id';
  if (args[0] === 'inspect') stdout = args.includes('{{.State.Status}}') ? 'exited' : '0';
  if (args.includes('logs') && args.includes('fake-brevo')) stdout = 'accepted send\\nwebhook replayed tag=fixture status=204';
  return { status: 0, stdout, stderr: '' };
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', preload, resolve('scripts', script), ...(reuse ? ['--reuse-artifacts'] : [])], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, TMPDIR: directory, COMPOSE_PROJECT_NAME: 'unrelated-project', GONES_IMAGE_API: 'untrusted:tag' }
  });
  let calls: Call[] = [];
  try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { /* No Docker calls is the fail-closed contract. */ }
  return { result, calls };
}

describe('dedicated rehearsal artifact reuse', () => {
  for (const script of scripts) {
    describe(script, () => {
      it.each([undefined, '{invalid', null, {}, { images: {} }, { images: [] }])('refuses malformed or missing manifest %j before any Docker call', (input) => {
        const { result, calls } = rehearsal(script, input);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Release artifact reuse refused:');
        expect(calls).toEqual([]);
      });

      it.each(names)('requires exactly one immutable digest for %s before any Docker call', (name) => {
        for (const digest of ['', 'gones-api:candidate', `sha256:${'a'.repeat(63)}`, `sha256:${'g'.repeat(64)}`, `sha256:${'A'.repeat(64)}`, 123]) {
          const input = manifest();
          Object.assign(input.images.find((image) => image.name === name)!, { digest });
          const { result, calls } = rehearsal(script, input);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(`Release artifact reuse refused: ${name}`);
          expect(calls).toEqual([]);
        }
        const missing = manifest();
        missing.images = missing.images.filter((image) => image.name !== name);
        expect(rehearsal(script, missing).calls).toEqual([]);
        const duplicate = manifest();
        duplicate.images.push(duplicate.images.find((image) => image.name === name)!);
        expect(rehearsal(script, duplicate).calls).toEqual([]);
      });

      it('pins every Compose call to candidate digests without changing project identity or rebuilding artifacts', () => {
        const { result, calls } = rehearsal(script, manifest());
        expect(result.status).not.toBe(0);
        const composeCalls = calls.filter(({ args }) => args[0] === 'compose');
        expect(composeCalls.length).toBeGreaterThan(2);
        for (const { args, env } of composeCalls) {
          expect(args.slice(0, 7)).toEqual(['compose', '-f', 'compose.release-test.yaml', '-f', 'compose.release-candidate.yaml', '--project-name', 'gones-release-test']);
          for (const image of manifest().images) expect(env[`GONES_IMAGE_${image.name.toUpperCase()}`]).toBe(image.digest);
          expect(env['COMPOSE_PROJECT_NAME']).toBe('gones-release-test');
          expect(args).not.toContain('--build');
          if (args.includes('build')) {
            const services = args.slice(args.indexOf('build') + 1);
            expect(services.length).toBeGreaterThan(0);
            expect(services.every((service) => !names.includes(service))).toBe(true);
          }
        }
        expect(composeCalls.some(({ args }) => args.includes('up') && args.includes('--no-build'))).toBe(true);
        expect(composeCalls.at(-1)!.args).toContain('down');
      });
    });
  }

  it('runs backup and migrator from the overlay without building the backup release image', () => {
    const { result, calls } = rehearsal(scripts[1], manifest(), true, 'not-a-command');
    expect(result.stderr).toContain('backup boundary observed');
    const runs = calls.filter(({ args }) => args.includes('run'));
    expect(runs.some(({ args }) => args.includes('migrator'))).toBe(true);
    expect(runs.some(({ args }) => args.includes('backup'))).toBe(true);
    expect(calls.filter(({ args }) => args.includes('build')).map(({ args }) => args.slice(args.indexOf('build') + 1))).toEqual([['bootstrap']]);
    for (const { args, env } of runs) {
      expect(args).toContain('compose.release-candidate.yaml');
      expect(env['GONES_IMAGE_BACKUP']).toBe(manifest().images[3].digest);
      expect(env['GONES_IMAGE_MIGRATOR']).toBe(manifest().images[2].digest);
    }
  });

  it('forwards candidate digests and project identity to migration smoke and checks injected frontend config', () => {
    const { result, calls } = rehearsal(scripts[0], manifest(), true, 'not-a-command');
    expect(result.stderr).toContain('migration smoke boundary observed');
    expect(result.stdout).toContain('ok   the candidate SPA serves the injected rehearsal origin');
    const smoke = calls.find(({ args }) => args.includes('scripts/smoke-migration.mjs'))!;
    expect(smoke.env['GONES_COMPOSE_FILE']).toBe('compose.release-test.yaml,compose.release-candidate.yaml');
    expect(smoke.env['COMPOSE_PROJECT_NAME']).toBe('gones-release-test');
    for (const image of manifest().images) expect(smoke.env[`GONES_IMAGE_${image.name.toUpperCase()}`]).toBe(image.digest);
    expect(calls.some(({ args }) => args.some((arg) => arg.includes('grep -rl')))).toBe(false);
    expect(calls.filter(({ args }) => args.includes('build')).flatMap(({ args }) => args.slice(args.indexOf('build') + 1))).toEqual([
      'bootstrap', 'fake-identity', 'fake-brevo', 'tls-proxy', 'journeys', 'egress-probe'
    ]);
  });

  it.each([true, false])('renders effective Compose config without artifact build fallback only in reuse mode (%s)', (reuse) => {
    // Use the real merge engine: CLI doubles cannot detect an implicit `run` build.
    const result = spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'compose.release-test.yaml',
      ...(reuse ? ['-f', 'compose.release-candidate.yaml'] : []), '--project-name', 'gones-release-test',
      '--profile', 'tools', 'config', '--format', 'json'], {
      encoding: 'utf8', timeout: 10_000,
      env: { PATH: process.env['PATH'], HOME: process.env['HOME'],
        ...Object.fromEntries(manifest().images.map(({ name, digest }) => [`GONES_IMAGE_${name.toUpperCase()}`, digest])) }
    });
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout) as {
      name: string;
      services: Record<string, { image?: string; pull_policy?: string; build?: unknown }>;
      volumes: Record<string, { name: string }>;
    };
    for (const { name, digest } of manifest().images) {
      const service = config.services[name];
      if (reuse) {
        expect(service.image, name).toBe(digest);
        expect(service.pull_policy, name).toBe('never');
        expect(service, `${name}: inherited build permits implicit Compose run fallback`).not.toHaveProperty('build');
      } else {
        expect(service.build, name).toBeDefined();
      }
    }
    for (const name of ['bootstrap', 'fake-identity', 'fake-brevo', 'tls-proxy', 'journeys', 'egress-probe']) {
      expect(config.services[name].build, name).toBeDefined();
    }
    expect(config.name).toBe('gones-release-test');
    expect(config.volumes['postgres-data'].name).toBe('gones-release-test_postgres-data');
    expect(config.volumes['event-image-data'].name).toBe('gones-release-test_event-image-data');
  });

  it('preserves the backup source-build path and cleanup without a manifest', () => {
    const { calls } = rehearsal(scripts[1], undefined, false, 'not-a-command');
    expect(calls.some(({ args }) => args.includes('up') && args.includes('--build'))).toBe(true);
    expect(calls.some(({ args }) => args.slice(-2).join(' ') === 'build backup')).toBe(true);
    expect(calls.every(({ args }) => !args.includes('compose.release-candidate.yaml'))).toBe(true);
    expect(calls.at(-1)!.args).toEqual(['compose', '-f', 'compose.release-test.yaml', '--profile', 'tools', 'down', '--volumes', '--remove-orphans']);
  });

  it('preserves the release source-build path without requiring a manifest', () => {
    const { result, calls } = rehearsal(scripts[0], undefined, false);
    expect(result.status).not.toBe(0);
    expect(calls.some(({ args }) => args.join(' ') === 'compose -f compose.release-test.yaml --profile tools build')).toBe(true);
    expect(calls.some(({ args }) => args.includes('up') && args.includes('--build'))).toBe(true);
    expect(calls.every(({ args }) => !args.includes('compose.release-candidate.yaml'))).toBe(true);
  });
});
