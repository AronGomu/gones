import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('opt-in idle Worker local runtime', () => {
  it('requires explicit override, reuses private mounts, probes local state', () => {
    const override = read('compose.worker-idle.yaml');
    expect(override.match(/GONES_WORKER_IDLE_MODE: "true"/g)).toHaveLength(2);
    expect(override.match(/GONES_WORKER_HEALTH_PATH: \/run\/gones-worker\/health.json/g)).toHaveLength(2);
    expect(override).toContain('["CMD", "dotnet", "Gones.Worker.dll", "--health"]');
    expect(override).not.toMatch(/ports:|GONES_WORKER_WAKE_TOKEN:|health\/ready/);
    const base = read('compose.yaml');
    expect(base).not.toContain('GONES_WORKER_IDLE_MODE');
    expect(base).toContain('worker-wake:/run/gones-worker:ro');
    expect(base).toMatch(/^\s+- worker-wake:\/run\/gones-worker$/m);
    expect(read('backend/src/Gones.Api/Dockerfile')).toContain('/health/live');
  });

  it('health CLI returns before DB setup; business auth and deep readiness stay present', () => {
    const worker = read('backend/src/Gones.Worker/Program.cs');
    expect(worker.indexOf('args.SequenceEqual(["--health"])')).toBeLessThan(worker.indexOf('AddGonesPersistence'));
    const api = read('backend/src/Gones.Api/Program.cs');
    expect(api.indexOf('context.Request.Path.Value == "/health/worker"')).toBeLessThan(api.indexOf('app.UseAuthentication()'));
    expect(api).toContain('healthChecks.AddDbContextCheck<GonesDbContext>("database")');
    expect(api).toContain('healthChecks.AddCheck<EventImageStorageHealthCheck>("eventImageStorage")');
    expect(api).toContain('app.MapHealthChecks("/health/ready"');
  });

  it('rejects polling-only SQL smoke before fixtures; retains executable idle equivalent', () => {
    const smoke = read('scripts/smoke-scheduler.mjs');
    expect(smoke.indexOf('Scheduler SQL smoke requires polling mode')).toBeLessThan(smoke.indexOf('INSERT INTO asp_net_users'));
    expect(read('docs/WORKER_IDLE.md')).toContain('WorkerDueRuntimeTests');
    expect(read('docs/WORKER_IDLE.md')).toContain('Fake scheduler time + EF connection evidence does not prove physical pooled sockets closed');
  });
});
