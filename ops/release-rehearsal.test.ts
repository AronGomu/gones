import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - the release rehearsal guard is a plain ESM module shared with the CLI.
import {
  acquireReleaseRehearsalLock,
  assertFreshStateVolumes,
  cleanupReleaseRehearsal,
  installSignalCleanup,
  releaseReleaseRehearsalLock,
  resetReleaseTestStack
} from '../scripts/release-rehearsal-guard.mjs';

const scratchDirectories: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gones-release-rehearsal-test-'));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release rehearsal process guard', () => {
  it('aborts when the initial docker compose down --volumes fails', () => {
    const listProjectVolumes = vi.fn(() => []);

    expect(() => resetReleaseTestStack(
      () => ({ status: 17 }),
      listProjectVolumes
    )).toThrow('Initial release-test teardown failed: docker compose down --volumes --remove-orphans exited 17');
    expect(listProjectVolumes).not.toHaveBeenCalled();
  });

  it('aborts when old project volumes remain after teardown', () => {
    expect(() => resetReleaseTestStack(
      () => ({ status: 0 }),
      () => [{ name: 'gones-release-test_postgres-data', logicalName: 'postgres-data' }]
    )).toThrow('Release-test teardown left project volumes: gones-release-test_postgres-data');
  });

  it('requires freshly created PostgreSQL and MinIO volumes before journeys', () => {
    expect(() => assertFreshStateVolumes([
      { name: 'gones-release-test_postgres-data', logicalName: 'postgres-data' }
    ])).toThrow('Release-test stack did not create fresh required volumes: event-image-data');

    expect(assertFreshStateVolumes([
      { name: 'gones-release-test_postgres-data', logicalName: 'postgres-data' },
      { name: 'gones-release-test_event-image-data', logicalName: 'event-image-data' },
      { name: 'gones-release-test_certs', logicalName: 'certs' }
    ])).toEqual([
      'gones-release-test_postgres-data',
      'gones-release-test_event-image-data'
    ]);
  });

  it('rejects a concurrent rehearsal with a live-owner diagnostic', async () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    const first = await acquireReleaseRehearsalLock({ lockPath });

    await expect(acquireReleaseRehearsalLock({ lockPath })).rejects.toThrow(
      new RegExp(`Release rehearsal already running: pid ${process.pid} .*fixed project gones-release-test and port 8443`)
    );

    await expect(releaseReleaseRehearsalLock(first)).resolves.toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });

  it('allows exactly one owner when two processes concurrently encounter stale metadata', async () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    writeFileSync(lockPath, JSON.stringify({
      pid: 999_999_999,
      token: 'stale-token',
      processStartIdentity: 'linux:stale-boot:1',
      startedAt: '2026-08-31T00:00:00.000Z'
    }));

    const attempts = await Promise.allSettled([
      acquireReleaseRehearsalLock({ lockPath }),
      acquireReleaseRehearsalLock({ lockPath })
    ]);
    const acquired = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireReleaseRehearsalLock>>> =>
      attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');

    expect(acquired).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('Release rehearsal already running:');
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).token).toBe(acquired[0].value.token);
    await expect(releaseReleaseRehearsalLock(acquired[0].value)).resolves.toBe(true);
  });

  it('does not treat a reused PID with a different process start identity as the owner', async () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      token: 'previous-process-token',
      processStartIdentity: 'linux:previous-boot:1',
      startedAt: '2026-08-31T00:00:00.000Z'
    }));

    const acquired = await acquireReleaseRehearsalLock({ lockPath });
    const owner = JSON.parse(readFileSync(lockPath, 'utf8'));

    expect(owner.pid).toBe(process.pid);
    expect(owner.processStartIdentity).toMatch(/^linux:[^:]+:\d+$/);
    expect(owner.processStartIdentity).not.toBe('linux:previous-boot:1');
    expect(owner.token).toBe(acquired.token);
    await expect(releaseReleaseRehearsalLock(acquired)).resolves.toBe(true);
  });

  it('releases the owned lock even when stack and export cleanup fail', async () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    const lock = await acquireReleaseRehearsalLock({ lockPath });
    const report = vi.fn();

    const errors = await cleanupReleaseRehearsal({
      compose: () => { throw new Error('teardown exploded'); },
      exportDirectory: join(scratchDirectory(), 'export'),
      lock,
      removeExport: () => { throw new Error('export cleanup exploded'); },
      report
    });

    expect(errors).toEqual([
      'Release-test final teardown failed: teardown exploded',
      'Release-test export cleanup failed: export cleanup exploded'
    ]);
    expect(report).toHaveBeenCalledTimes(2);
    const next = await acquireReleaseRehearsalLock({ lockPath });
    await expect(releaseReleaseRehearsalLock(next)).resolves.toBe(true);
  });

  it('releases the kernel lock when writing owner metadata fails', async () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');

    await expect(acquireReleaseRehearsalLock({
      lockPath,
      writeOwnerMetadata: () => { throw new Error('metadata write exploded'); }
    })).rejects.toThrow('metadata write exploded');

    const acquired = await acquireReleaseRehearsalLock({ lockPath });
    await expect(releaseReleaseRehearsalLock(acquired)).resolves.toBe(true);
  });

  it('runs cleanup before exiting on a termination signal', async () => {
    const processTarget = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const cleanup = vi.fn(async () => undefined);
    const report = vi.fn();
    const uninstall = installSignalCleanup(cleanup, processTarget, report);

    processTarget.emit('SIGTERM');
    await vi.waitFor(() => expect(processTarget.exit).toHaveBeenCalledWith(143));

    expect(report).toHaveBeenCalledWith('Release rehearsal received SIGTERM; cleaning up before exit.');
    expect(cleanup).toHaveBeenCalledOnce();
    uninstall();
  });

  it('wires teardown, volume, lock, signal, and failure guards into the executable before journeys', () => {
    const source = readFileSync('scripts/release-rehearsal.mjs', 'utf8');
    const lock = source.indexOf('acquireReleaseRehearsalLock(');
    const reset = source.indexOf('resetReleaseTestStack(');
    const freshVolumes = source.indexOf('assertFreshStateVolumes(');
    const firstJourney = source.indexOf("journey('visitor'");

    expect(lock).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(lock);
    expect(freshVolumes).toBeGreaterThan(reset);
    expect(firstJourney).toBeGreaterThan(freshVolumes);
    expect(source).toContain('installSignalCleanup(cleanup)');
    expect(source).toMatch(/finally \{\s*await cleanup\(\);/);
  });
});
