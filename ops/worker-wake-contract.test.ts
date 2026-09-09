import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function service(compose: string, name: string): string {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|^volumes:|^networks:|$(?![\\s\\S]))`, 'm'));
  expect(match, `${name} service exists`).not.toBeNull();
  return match![0];
}

describe('private Worker wake runtime contract', () => {
  for (const file of ['compose.yaml', 'compose.release-test.yaml']) {
    it(`${file} grants API connect-only mount, Worker owned socket mount, no edge access`, () => {
      const compose = read(file);
      const api = service(compose, 'api');
      const worker = service(compose, 'worker');
      for (const process of [api, worker]) {
        expect(process).toContain('GONES_WORKER_WAKE_SOCKET: /run/gones-worker/wake.sock');
        expect(process).toContain('GONES_WORKER_WAKE_TOKEN_FILE:');
        expect(process).not.toMatch(/^\s+GONES_WORKER_WAKE_TOKEN:/m);
      }
      expect(api).toContain('worker-wake:/run/gones-worker:ro');
      expect(worker).toMatch(/^\s+- worker-wake:\/run\/gones-worker$/m);
      expect(worker).not.toMatch(/^\s+ports:/m);
      const edgeName = file === 'compose.yaml' ? 'frontend-release' : 'tls-proxy';
      expect(service(compose, edgeName)).not.toContain('worker-wake');
    });
  }

  it('bootstraps private directory with runtime UID, never persisted token literal', () => {
    const local = service(read('compose.yaml'), 'worker-wake-init');
    expect(local).toContain('head -c 32 /dev/urandom');
    expect(local).toContain('chown 1654:1654 /wake');
    expect(local).toContain('chmod 0700 /wake');
    const release = read('deploy/release-test/bootstrap.sh');
    expect(release).toContain('random_hex 32 > "$secrets/worker-wake-token"');
    expect(release).toContain('chown 1654:1654 /worker-wake');
    expect(release).toContain('chmod 0700 /worker-wake');
  });

  it('bounded W10a retains polling heartbeat; no idle-safe rollout claim', () => {
    expect(read('backend/src/Gones.Worker/Worker.cs')).toContain('GetRequiredService<WorkerHeartbeatStore>()');
    expect(read('backend/src/Gones.Worker/Worker.cs')).toContain('options.PollInterval');
    expect(read('docs/WORKER_SCHEDULING.md')).toContain('W10b due dispatcher/maintenance, W11 local health remain pending');
  });
});
