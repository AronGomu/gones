import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('rejects a concurrent rehearsal with a live-owner diagnostic', () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    const first = acquireReleaseRehearsalLock({ lockPath });

    expect(() => acquireReleaseRehearsalLock({ lockPath })).toThrow(
      new RegExp(`Release rehearsal already running: pid ${process.pid} .*fixed project gones-release-test and port 8443`)
    );

    expect(releaseReleaseRehearsalLock(first)).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('recovers a stale dead-owner lock and reports it', () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
      pid: 999_999_999,
      token: 'stale-token',
      startedAt: '2026-08-31T00:00:00.000Z'
    }));
    const report = vi.fn();

    const acquired = acquireReleaseRehearsalLock({
      lockPath,
      isProcessAlive: () => false,
      report
    });

    expect(report).toHaveBeenCalledWith(expect.stringContaining('Recovered stale release rehearsal lock from pid 999999999'));
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')).token).toBe(acquired.token);
    expect(releaseReleaseRehearsalLock(acquired)).toBe(true);
  });

  it('releases the owned lock even when stack and export cleanup fail', () => {
    const lockPath = join(scratchDirectory(), 'rehearsal.lock');
    const lock = acquireReleaseRehearsalLock({ lockPath });
    const report = vi.fn();

    const errors = cleanupReleaseRehearsal({
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
    expect(existsSync(lockPath)).toBe(false);
  });

  it('runs cleanup before exiting on a termination signal', () => {
    const processTarget = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const cleanup = vi.fn();
    const report = vi.fn();
    const uninstall = installSignalCleanup(cleanup, processTarget, report);

    processTarget.emit('SIGTERM');

    expect(report).toHaveBeenCalledWith('Release rehearsal received SIGTERM; cleaning up before exit.');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(processTarget.exit).toHaveBeenCalledWith(143);
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
    expect(source).toMatch(/finally \{\s*cleanup\(\);/);
  });
});
