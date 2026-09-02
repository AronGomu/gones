import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RELEASE_TEST_PROJECT = 'gones-release-test';
export const RELEASE_TEST_PORT = 8443;
export const RELEASE_REHEARSAL_LOCK_PATH = join(tmpdir(), `${RELEASE_TEST_PROJECT}.rehearsal.lock`);

const OWNER_FILE = 'owner.json';
const REQUIRED_STATE_VOLUMES = ['postgres-data', 'event-image-data'];
const INCOMPLETE_LOCK_GRACE_MS = 30_000;

const errorMessage = (error) => error instanceof Error ? error.message : String(error);

/** Returns every Docker volume owned by the fixed release-test Compose project. */
export function listReleaseProjectVolumes(runCommand) {
  const listed = runCommand('docker', [
    'volume', 'ls', '--quiet',
    '--filter', `label=com.docker.compose.project=${RELEASE_TEST_PROJECT}`
  ]);
  if (listed.status !== 0) {
    throw new Error(`Could not list ${RELEASE_TEST_PROJECT} volumes: docker volume ls exited ${listed.status}`);
  }

  const names = listed.stdout.trim().split('\n').map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return [];

  const inspected = runCommand('docker', ['volume', 'inspect', ...names]);
  if (inspected.status !== 0) {
    throw new Error(`Could not inspect ${RELEASE_TEST_PROJECT} volumes: docker volume inspect exited ${inspected.status}`);
  }

  let volumes;
  try {
    volumes = JSON.parse(inspected.stdout);
  } catch (error) {
    throw new Error(`Could not parse ${RELEASE_TEST_PROJECT} volume metadata: ${errorMessage(error)}`);
  }

  return volumes.map((volume) => ({
    name: volume.Name,
    logicalName: volume.Labels?.['com.docker.compose.volume'] ?? ''
  }));
}

/** Initial teardown is a hard prerequisite: no journey may reuse old project state. */
export function resetReleaseTestStack(compose, listProjectVolumes) {
  const down = compose(['down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
  if (down.status !== 0) {
    throw new Error(`Initial release-test teardown failed: docker compose down --volumes --remove-orphans exited ${down.status}`);
  }

  const leftovers = listProjectVolumes();
  if (leftovers.length > 0) {
    throw new Error(`Release-test teardown left project volumes: ${leftovers.map((volume) => volume.name).sort().join(', ')}`);
  }
}

/** The two durable product stores must have been created after the proved-empty reset. */
export function assertFreshStateVolumes(volumes) {
  const missing = REQUIRED_STATE_VOLUMES.filter((logicalName) =>
    volumes.filter((volume) => volume.logicalName === logicalName).length !== 1);
  if (missing.length > 0) {
    throw new Error(`Release-test stack did not create fresh required volumes: ${missing.join(', ')}`);
  }

  return REQUIRED_STATE_VOLUMES.map((logicalName) =>
    volumes.find((volume) => volume.logicalName === logicalName).name);
}

function ownerPath(lockPath) {
  return join(lockPath, OWNER_FILE);
}

function readOwner(lockPath) {
  try {
    const owner = JSON.parse(readFileSync(ownerPath(lockPath), 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || owner.token.length === 0) return null;
    return owner;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Atomically claims one host-wide lock for the fixed Compose project and published port.
 * A dead owner is renamed away before deletion so two stale-lock recoverers cannot delete the
 * winner's new lock.
 */
export function acquireReleaseRehearsalLock({
  lockPath = RELEASE_REHEARSAL_LOCK_PATH,
  pid = process.pid,
  isProcessAlive = processIsAlive,
  report = (message) => console.error(message)
} = {}) {
  const token = randomUUID();
  const owner = { pid, token, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      try {
        writeFileSync(ownerPath(lockPath), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      return { lockPath, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const existingOwner = readOwner(lockPath);
    if (existingOwner && isProcessAlive(existingOwner.pid)) {
      throw new Error(
        `Release rehearsal already running: pid ${existingOwner.pid} since ${existingOwner.startedAt ?? 'unknown time'} owns fixed project ${RELEASE_TEST_PROJECT} and port ${RELEASE_TEST_PORT} (lock ${lockPath})`
      );
    }

    if (!existingOwner) {
      let ageMilliseconds = 0;
      try {
        ageMilliseconds = Date.now() - statSync(lockPath).mtimeMs;
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (ageMilliseconds < INCOMPLETE_LOCK_GRACE_MS) {
        throw new Error(
          `Release rehearsal lock ${lockPath} has no readable owner metadata; another process may still be acquiring it. Retry after 30 seconds, then remove it only after confirming no rehearsal is running.`
        );
      }
    }

    const stalePath = `${lockPath}.stale-${pid}-${token}`;
    try {
      renameSync(lockPath, stalePath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    rmSync(stalePath, { recursive: true, force: true });
    report(`Recovered stale release rehearsal lock from pid ${existingOwner?.pid ?? 'unknown'} at ${lockPath}.`);
  }

  throw new Error(`Could not acquire release rehearsal lock ${lockPath} after concurrent stale-lock recovery.`);
}

/** Removes only lock carrying caller's ownership token. */
export function releaseReleaseRehearsalLock(lock) {
  const owner = readOwner(lock.lockPath);
  if (!owner) {
    if (!statExists(lock.lockPath)) return false;
    throw new Error(`Refusing to remove release rehearsal lock ${lock.lockPath}: owner metadata is unreadable.`);
  }
  if (owner.token !== lock.token) {
    throw new Error(`Refusing to remove release rehearsal lock ${lock.lockPath}: ownership changed.`);
  }
  rmSync(lock.lockPath, { recursive: true, force: true });
  return true;
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/** Best-effort stack cleanup never prevents owned lock release. */
export function cleanupReleaseRehearsal({
  compose,
  exportDirectory,
  lock,
  removeExport = (path) => rmSync(path, { recursive: true, force: true }),
  report = (message) => console.error(message)
}) {
  const errors = [];

  try {
    const down = compose(['--profile', 'tools', 'down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
    if (down.status !== 0) errors.push(`Release-test final teardown failed: docker compose down exited ${down.status}`);
  } catch (error) {
    errors.push(`Release-test final teardown failed: ${errorMessage(error)}`);
  }

  try {
    removeExport(exportDirectory);
  } catch (error) {
    errors.push(`Release-test export cleanup failed: ${errorMessage(error)}`);
  }

  try {
    releaseReleaseRehearsalLock(lock);
  } catch (error) {
    errors.push(`Release rehearsal lock cleanup failed: ${errorMessage(error)}`);
  }

  for (const error of errors) report(error);
  return errors;
}

/** Installs explicit signal cleanup because process.exit does not run surrounding finally blocks. */
export function installSignalCleanup(cleanup, processTarget = process, report = (message) => console.error(message)) {
  const signals = new Map([
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143]
  ]);
  const handlers = new Map();

  for (const [signal, exitCode] of signals) {
    const handler = () => {
      report(`Release rehearsal received ${signal}; cleaning up before exit.`);
      try {
        cleanup();
      } finally {
        processTarget.exit(exitCode);
      }
    };
    handlers.set(signal, handler);
    processTarget.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) processTarget.removeListener(signal, handler);
  };
}
