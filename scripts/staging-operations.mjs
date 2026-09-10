#!/usr/bin/env node
/**
 * Bounded staging host operations. This script is intentionally staging-only: it never accepts a
 * production Compose project, never removes volumes, and never runs a system-wide apply.
 *
 * Commands:
 *   wake [minutes]   open one bounded staging window and start the release services
 *   status           print current window state
 *   stop             drain and stop staging services, preserving volumes
 *   expire           scheduler hook: stop only when the persisted window has expired
 *   budget           evaluate a measured monthly usage snapshot against the €50 ceiling
 *   backup           run the encrypted backup image for staging
 *   restore          restore into an explicitly isolated target DSN
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { run } from './release-images.mjs';

export const STAGING_PROJECT = 'gones-staging';
export const STAGING_COMPOSE_FILE = 'compose.staging.yaml';
export const STAGING_STATE_DIR = process.env.GONES_STAGING_STATE_DIR || '/var/lib/gones/staging';
export const STAGING_STATE_FILE = join(STAGING_STATE_DIR, 'window.json');
export const MAX_WINDOW_MINUTES = 72 * 60;
export const DEFAULT_WINDOW_MINUTES = 60;
export const STAGING_ACTIVE_CU_BUDGET = 80;
export const FREE_DB_CU_HOURS = 100;
export const MONTHLY_CEILING_EUR = 50;

const errorMessage = (error) => error instanceof Error ? error.message : String(error);

function fail(message, code = 2) {
  console.error(`gones-staging: ${message}`);
  process.exitCode = code;
  return false;
}

export function parseMinutes(raw = String(DEFAULT_WINDOW_MINUTES)) {
  if (!/^\d+$/.test(raw)) throw new Error('window duration must be a whole number of minutes');
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_WINDOW_MINUTES) {
    throw new Error(`window duration must be between 1 and ${MAX_WINDOW_MINUTES} minutes`);
  }
  return minutes;
}

export function assertStagingProject(project = STAGING_PROJECT) {
  if (project !== STAGING_PROJECT) throw new Error(`refusing non-staging Compose project ${project}`);
  return project;
}

export function composeCommand(args, runner = run) {
  assertStagingProject(STAGING_PROJECT);
  return runner('docker', ['compose', '--project-name', STAGING_PROJECT, '--file', STAGING_COMPOSE_FILE, ...args], { stdio: 'inherit' });
}

function requireStateDir() {
  if (!isAbsolute(STAGING_STATE_DIR)) throw new Error('GONES_STAGING_STATE_DIR must be an absolute path');
  mkdirSync(STAGING_STATE_DIR, { recursive: true, mode: 0o700 });
}

export function readWindow(path = STAGING_STATE_FILE, reader = readFileSync) {
  if (!existsSync(path)) return null;
  let value;
  try { value = JSON.parse(reader(path, 'utf8')); } catch { throw new Error('staging window state is invalid'); }
  if (value?.environment !== 'staging' || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error('staging window state is invalid');
  }
  return value;
}

function writeWindow(value) {
  requireStateDir();
  const temporary = `${STAGING_STATE_FILE}.partial-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, STAGING_STATE_FILE);
}

function activeWindow() {
  const state = readWindow();
  return state && Date.parse(state.expiresAt) > Date.now() ? state : null;
}

function wake(minutes = DEFAULT_WINDOW_MINUTES) {
  const duration = parseMinutes(String(minutes));
  const existing = activeWindow();
  if (existing) throw new Error(`staging window already active until ${existing.expiresAt}; use stop before reopening`);

  // Migrator and grants run first through Compose dependency conditions. --no-build prevents an
  // operator action from creating an unreviewed artifact on the shared host.
  const result = composeCommand(['up', '--detach', '--no-build', 'migrator', 'permissions', 'api', 'worker', 'frontend']);
  if (result.status !== 0) throw new Error(`staging wake failed with status ${result.status}`);
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + duration * 60_000);
  writeWindow({ environment: 'staging', startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(), windowMinutes: duration, status: 'active' });
  console.log(`gones-staging: active until ${expiresAt.toISOString()}`);
}

function stop() {
  const state = readWindow();
  if (!state) {
    console.log('gones-staging: no window state; stopping services is still refused');
    return;
  }
  if (state.status === 'stopped') {
    console.log('gones-staging: already stopped');
    return;
  }
  if (state.status === 'stopping') throw new Error('staging stop is already in progress');
  writeWindow({ ...state, status: 'stopping', stopStartedAt: new Date().toISOString() });

  // Edge maintenance must be enabled before this command. API/frontend stop first rejects new
  // application traffic; Worker then drains committed work using its SIGTERM timeout. No --volumes,
  // down, prune, or production project appears here: data survives every window.
  const services = ['frontend', 'api', 'worker'];
  for (const service of services) {
    const result = composeCommand(['stop', '--timeout', '30', service]);
    if (result.status !== 0) {
      writeWindow({ ...state, status: 'drain-failed', failedService: service, failedAt: new Date().toISOString() });
      throw new Error(`staging drain failed for ${service}; production was not touched`);
    }
  }
  writeWindow({ ...state, status: 'stopped', stoppedAt: new Date().toISOString() });
  console.log('gones-staging: drained and stopped; persistent DB/object volumes preserved');
}

function expire() {
  const state = readWindow();
  if (!state || state.status !== 'active') return;
  if (Date.parse(state.expiresAt) > Date.now()) return;
  stop();
}

function status() {
  const state = readWindow();
  if (!state) {
    console.log(JSON.stringify({ environment: 'staging', status: 'inactive' }));
    return;
  }
  const expired = Date.parse(state.expiresAt) <= Date.now() && state.status === 'active';
  console.log(JSON.stringify(expired ? { ...state, status: 'expired' } : state));
}

export function projectMonthlyBudget(input) {
  const number = (name, fallback = 0) => {
    const value = input[name] ?? fallback;
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
    return value;
  };
  const freeQuota = number('freeDbCuHours', FREE_DB_CU_HOURS);
  const stagingDbCuHours = number('stagingDbCuHours');
  const productionDbCuHours = number('productionDbCuHours');
  const stagingOverage = Math.max(0, stagingDbCuHours - freeQuota);
  const productionOverage = Math.max(0, productionDbCuHours - freeQuota);
  const dbPrice = number('dbPriceEurPerCuHour');
  const dbEur = (stagingOverage + productionOverage) * dbPrice;
  const fixedEur = number('fixedEur');
  const variableEur = number('objectEur') + number('telemetryEur') + number('emailEur') + number('networkEur');
  const totalEur = fixedEur + variableEur + dbEur;
  const stagingWithinActiveBudget = stagingDbCuHours <= number('stagingActiveCuBudget', STAGING_ACTIVE_CU_BUDGET);
  const ceilingEur = number('ceilingEur', MONTHLY_CEILING_EUR);
  return {
    stagingDbCuHours,
    productionDbCuHours,
    stagingOverageCuHours: stagingOverage,
    productionOverageCuHours: productionOverage,
    dbEur,
    fixedEur,
    variableEur,
    totalEur,
    ceilingEur,
    ceilingRemainingEur: ceilingEur - totalEur,
    stagingWithinActiveBudget,
    withinCeiling: totalEur <= ceilingEur,
    withinBudget: stagingWithinActiveBudget && totalEur <= ceilingEur,
    alertLevel: totalEur >= ceilingEur * 0.95 ? 'critical' : totalEur >= ceilingEur * 0.85 ? 'warning' : totalEur >= ceilingEur * 0.70 ? 'notice' : 'ok'
  };
}

function readUsage(path) {
  if (!path || !isAbsolute(path)) throw new Error('--usage-file must be an absolute path');
  const usage = JSON.parse(readFileSync(path, 'utf8'));
  return usage;
}

function budget(usagePath = process.env.GONES_BUDGET_USAGE_FILE) {
  if (!usagePath) throw new Error('budget requires GONES_BUDGET_USAGE_FILE or --usage-file');
  const result = projectMonthlyBudget(readUsage(usagePath));
  console.log(JSON.stringify(result, null, 2));
  if (!result.withinBudget) {
    process.exitCode = 1;
    console.error('gones-staging: budget gate failed; do not extend staging window');
  }
}

function environmentArg() {
  const value = process.env.GONES_BACKUP_ENVIRONMENT || 'staging';
  if (value !== 'staging' && value !== 'production') throw new Error('GONES_BACKUP_ENVIRONMENT must be staging or production');
  return value;
}

function backup() {
  const environment = environmentArg();
  const project = process.env.GONES_BACKUP_PROJECT || STAGING_PROJECT;
  if (environment === 'staging') assertStagingProject(project);
  else if (project !== 'gones-prod') throw new Error('production backup requires Compose project gones-prod');
  const name = process.env.GONES_BACKUP_NAME || `${environment}-${new Date().toISOString().replace(/[-:.]/g, '').replace(/Z$/, 'Z')}`;
  if (!/^(staging|production)-[A-Za-z0-9_-]+$/.test(name)) throw new Error('backup name must be environment-prefixed and path-safe');
  const result = run('docker', ['compose', '--project-name', project, '--file', process.env.GONES_BACKUP_COMPOSE_FILE || STAGING_COMPOSE_FILE, '--profile', 'tools', 'run', '--rm', '--no-deps', '-e', `GONES_BACKUP_NAME=${name}`, 'backup'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`encrypted ${environment} backup failed with status ${result.status}`);
}

function restore() {
  const environment = environmentArg();
  const project = process.env.GONES_RESTORE_PROJECT || STAGING_PROJECT;
  if (environment === 'staging') assertStagingProject(project);
  else if (project !== 'gones-prod') throw new Error('production restore requires Compose project gones-prod');
  if (process.env.GONES_RESTORE_ISOLATED !== 'true') throw new Error('restore requires GONES_RESTORE_ISOLATED=true and a separate target DSN');
  const targetDsn = process.env.GONES_RESTORE_TARGET_DSN_FILE;
  if (!targetDsn || !isAbsolute(targetDsn)) throw new Error('restore requires absolute GONES_RESTORE_TARGET_DSN_FILE');
  if (!existsSync(targetDsn)) throw new Error('restore target DSN file does not exist');
  const archive = process.env.GONES_BACKUP_FILE;
  if (!archive || archive.includes('/') || archive.includes('..')) throw new Error('restore requires a path-safe GONES_BACKUP_FILE archive name');
  const composeFile = process.env.GONES_BACKUP_COMPOSE_FILE || STAGING_COMPOSE_FILE;
  const args = ['compose', '--project-name', project, '--file', composeFile, '--profile', 'tools', 'run', '--rm', '--no-deps', '-v', `${resolve(targetDsn)}:/run/secrets/restore-dsn:ro`, '-e', 'GONES_BACKUP_DSN=', '-e', 'GONES_BACKUP_DSN_FILE=/run/secrets/restore-dsn', '--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', archive];
  const result = run('docker', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`isolated ${environment} restore failed with status ${result.status}`);
}

export function main(argv = process.argv.slice(2)) {
  const [command, value, optionValue] = argv;
  try {
    if (command === 'wake') wake(parseMinutes(value || String(DEFAULT_WINDOW_MINUTES)));
    else if (command === 'status') status();
    else if (command === 'stop') stop();
    else if (command === 'expire') expire();
    else if (command === 'budget') budget(value === '--usage-file' ? optionValue : value);
    else if (command === 'backup') backup();
    else if (command === 'restore') restore();
    else throw new Error('usage: staging-operations.mjs <wake [minutes]|status|stop|expire|budget [usage-file]|backup|restore>');
    return process.exitCode || 0;
  } catch (error) {
    fail(errorMessage(error));
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
