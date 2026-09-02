import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RELEASE_TEST_PROJECT = 'gones-release-test';
export const RELEASE_TEST_PORT = 8443;
export const RELEASE_REHEARSAL_LOCK_PATH = join(tmpdir(), `${RELEASE_TEST_PROJECT}.rehearsal.lock`);

const REQUIRED_STATE_VOLUMES = ['postgres-data', 'event-image-data'];
const LOCK_ACQUIRED_MESSAGE = 'release-rehearsal-lock-acquired';
const LOCK_HOLDER_SOURCE = `process.stdout.write('${LOCK_ACQUIRED_MESSAGE}\\n'); process.stdin.resume();`;

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

function readOwner(lockPath) {
  try {
    const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || owner.token.length === 0) return null;
    return owner;
  } catch {
    return null;
  }
}

function linuxProcessStartIdentity(pid) {
  const processStat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const commandEnd = processStat.lastIndexOf(')');
  const fieldsAfterCommand = processStat.slice(commandEnd + 2).trim().split(/\s+/);
  const startTime = fieldsAfterCommand[19];
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  if (commandEnd < 0 || !/^\d+$/.test(startTime) || bootId.length === 0) {
    throw new Error(`Could not read Linux process start identity for pid ${pid}.`);
  }
  return `linux:${bootId}:${startTime}`;
}

function writeOwner(lockPath, owner) {
  writeFileSync(lockPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  chmodSync(lockPath, 0o600);
}

function startKernelLockHolder(lockPath) {
  const holder = spawn('flock', [
    '--exclusive',
    '--nonblock',
    '--conflict-exit-code', '75',
    lockPath,
    process.execPath,
    '-e', LOCK_HOLDER_SOURCE
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      holder.kill('SIGKILL');
      reject(new Error(`Timed out acquiring release rehearsal kernel lock ${lockPath}.`));
    }, 5_000);

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    holder.stderr.setEncoding('utf8');
    holder.stderr.on('data', (chunk) => { stderr += chunk; });
    holder.stdout.setEncoding('utf8');
    holder.stdout.on('data', (chunk) => {
      if (chunk.includes(LOCK_ACQUIRED_MESSAGE)) finish(() => resolve(holder));
    });
    holder.once('error', (error) => finish(() => reject(
      new Error(`Could not start flock for release rehearsal lock ${lockPath}: ${errorMessage(error)}`)
    )));
    holder.once('exit', (code, signal) => finish(() => {
      if (code === 75) {
        const existingOwner = readOwner(lockPath);
        const ownerDescription = existingOwner
          ? `pid ${existingOwner.pid} since ${existingOwner.startedAt ?? 'unknown time'}`
          : 'an owner with unavailable metadata';
        reject(new Error(
          `Release rehearsal already running: ${ownerDescription} owns fixed project ${RELEASE_TEST_PROJECT} and port ${RELEASE_TEST_PORT} (lock ${lockPath})`
        ));
        return;
      }
      reject(new Error(
        `Release rehearsal kernel lock holder exited before acquisition: code ${code ?? 'null'}, signal ${signal ?? 'none'}${stderr.trim() ? ` (${stderr.trim()})` : ''}`
      ));
    }));
  });
}

async function stopKernelLockHolder(holder) {
  if (holder.exitCode !== null || holder.signalCode !== null) return;

  await new Promise((resolve) => {
    const forceStop = setTimeout(() => holder.kill('SIGKILL'), 2_000);
    holder.once('exit', () => {
      clearTimeout(forceStop);
      resolve();
    });
    holder.stdin.end();
  });
}

/**
 * Claims one host-wide advisory lock for the fixed Compose project and published port.
 * `flock` arbitrates ownership in the kernel; metadata never decides ownership and may remain stale.
 */
export async function acquireReleaseRehearsalLock({
  lockPath = RELEASE_REHEARSAL_LOCK_PATH,
  pid = process.pid,
  writeOwnerMetadata = writeOwner
} = {}) {
  const token = randomUUID();
  const holder = await startKernelLockHolder(lockPath);
  const owner = {
    pid,
    token,
    processStartIdentity: linuxProcessStartIdentity(pid),
    startedAt: new Date().toISOString()
  };

  try {
    writeOwnerMetadata(lockPath, owner);
  } catch (error) {
    await stopKernelLockHolder(holder);
    throw error;
  }

  return { lockPath, token, holder, released: false };
}

/** Releases caller's kernel lock; persistent metadata file is harmless without that lock. */
export async function releaseReleaseRehearsalLock(lock) {
  if (lock.released) return false;

  const owner = readOwner(lock.lockPath);
  lock.released = true;
  await stopKernelLockHolder(lock.holder);

  if (!owner) {
    throw new Error(`Release rehearsal lock ${lock.lockPath} owner metadata is unreadable.`);
  }
  if (owner.token !== lock.token) {
    throw new Error(`Release rehearsal lock ${lock.lockPath} metadata ownership changed.`);
  }
  return true;
}

/** Best-effort stack cleanup never prevents owned lock release. */
export async function cleanupReleaseRehearsal({
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
    await releaseReleaseRehearsalLock(lock);
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
  let cleanupStarted = false;

  for (const [signal, exitCode] of signals) {
    const handler = () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      report(`Release rehearsal received ${signal}; cleaning up before exit.`);
      Promise.resolve()
        .then(cleanup)
        .catch((error) => report(`Release rehearsal signal cleanup failed: ${errorMessage(error)}`))
        .finally(() => processTarget.exit(exitCode));
    };
    handlers.set(signal, handler);
    processTarget.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) processTarget.removeListener(signal, handler);
  };
}
