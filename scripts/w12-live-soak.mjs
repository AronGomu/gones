#!/usr/bin/env node
/** File-only W12 capture. Provider/operator attestations remain an external trust boundary. */
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeFileSync, constants } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../ops/w12-live-soak.schema.json', import.meta.url), 'utf8'));
const HOUR = 3_600_000;
export const W12_DURATION_HOURS = 72;
export const W12_MAX_AGE_HOURS = 24;
const MAX_BYTES = 16 * 1024 * 1024;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const sameIdentity = (actual, expected) => Object.keys(schema.$defs.identity.properties).every((key) => actual[key] === expected[key]);
const close = (actual, expected) => Math.abs(actual - expected) <= 1e-8;

// Dependency-free validator for the exact JSON Schema keywords used by this contract.
// Never include input values or unknown property names in diagnostics.
function parse(value, definition, path = definition) {
  const check = (value, rule, path) => {
    if (rule.$ref) return check(value, schema.$defs[rule.$ref.split('/').at(-1)], path);
    const invalid = () => { throw new Error(`W12 schema invalid at ${path}`); };
    if ('const' in rule && value !== rule.const) invalid();
    if (rule.enum && !rule.enum.includes(value)) invalid();
    if (rule.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
      if (Object.keys(value).some((key) => !Object.hasOwn(rule.properties, key))) invalid();
      for (const key of rule.required) if (!Object.hasOwn(value, key)) invalid();
      for (const [key, child] of Object.entries(rule.properties)) check(value[key], child, `${path}.${key}`);
    } else if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length < (rule.minItems ?? 0) || value.length > rule.maxItems) invalid();
      if (rule.uniqueItems && new Set(value).size !== value.length) invalid();
      value.forEach((entry, index) => check(entry, rule.items, `${path}[${index}]`));
    } else if (rule.type === 'string') {
      if (typeof value !== 'string' || (rule.pattern && !new RegExp(rule.pattern).test(value))) invalid();
      if (rule.format === 'date-time' && (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) invalid();
    } else if (rule.type === 'number' || rule.type === 'integer') {
      if (!Number.isFinite(value) || (rule.type === 'integer' && !Number.isSafeInteger(value))) invalid();
      if (value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity) || value <= (rule.exclusiveMinimum ?? -Infinity)) invalid();
    }
  };
  check(value, schema.$defs[definition], path);
  return value;
}

function clock(now) {
  requireValue(Number.isFinite(now) && Number.isFinite(new Date(now).getTime()), 'W12 clock is invalid');
}

function checkSegments(state, now, complete = false) {
  clock(now);
  const began = Date.parse(state.startedAt);
  const ends = Date.parse(state.endsAt ?? state.endedAt);
  requireValue(ends - began === W12_DURATION_HOURS * HOUR, 'W12 requires exactly 72 hours');
  requireValue(began <= now, 'W12 capture starts in the future');
  let cursor = began;
  const workloads = new Set();
  const jobs = new Set();
  let expectedJobs = 0, expectedEffects = 0, activeHours = 0, cuHours = 0, suspensions = 0;
  for (const segment of state.segments) {
    requireValue(sameIdentity(segment.identity, state.identity), 'W12 segment identity mismatch');
    const start = Date.parse(segment.startedAt), end = Date.parse(segment.endedAt);
    requireValue(start === cursor && end > start && end <= ends && end <= now, 'W12 intervals must be contiguous, ordered and inside the observed window');
    requireValue(segment.jobs.expected === segment.jobs.completed && ['lost', 'duplicates', 'deadlineMisses', 'failures'].every((key) => segment.jobs[key] === 0), 'W12 job correctness failed');
    requireValue(segment.jobs.maxImmediateLatencyMs <= 5000 && segment.jobs.maxRecoveryLatencyMs <= HOUR, 'W12 job deadline failed');
    requireValue(segment.providerEffects.expected === segment.providerEffects.observed && segment.providerEffects.duplicates === 0 && segment.providerEffects.unresolved === 0, 'W12 provider effects failed');
    requireValue(segment.db.activeHours <= (end - start) / HOUR, 'W12 DB active hours exceed interval');
    segment.workloadClasses.forEach((entry) => workloads.add(entry));
    segment.jobClasses.forEach((entry) => jobs.add(entry));
    expectedJobs += segment.jobs.expected; expectedEffects += segment.providerEffects.expected;
    activeHours += segment.db.activeHours; cuHours += segment.db.cuHours; suspensions += segment.db.suspensions;
    cursor = end;
  }
  if (complete) {
    requireValue(cursor === ends && ends <= now, 'W12 capture is incomplete');
    requireValue(now - ends <= W12_MAX_AGE_HOURS * HOUR, 'W12 evidence is stale');
    requireValue(schema.$defs.segment.properties.workloadClasses.items.enum.every((entry) => workloads.has(entry)), 'W12 workload coverage is incomplete');
    requireValue(schema.$defs.segment.properties.jobClasses.items.enum.every((entry) => jobs.has(entry)), 'W12 job coverage is incomplete');
    requireValue(expectedJobs > 0 && expectedEffects > 0, 'W12 requires observed jobs and provider effects');
    requireValue(suspensions > 0 && activeHours > 0 && activeHours < W12_DURATION_HOURS && cuHours > 0, 'W12 DB suspension measurements are missing');
  }
  return { activeHours, cuHours };
}

function compareCost(report, measured) {
  const cost = report.cost, baseline = cost.baseline;
  requireValue(sameIdentity(cost.identity, report.identity) && cost.startedAt === report.startedAt && cost.endedAt === report.endedAt, 'W12 cost identity/window mismatch');
  requireValue(baseline.workloadDigest === report.identity.workloadDigest && baseline.computeUnits === cost.computeUnits, 'W12 always-awake baseline is not equivalent');
  requireValue(close(baseline.cuHours, W12_DURATION_HOURS * cost.computeUnits), 'W12 baseline compute is inconsistent');
  for (const segment of report.segments) requireValue(close(segment.db.cuHours, segment.db.activeHours * cost.computeUnits), 'W12 measured compute is inconsistent');
  const totalEur = Object.values(cost.monthlyCosts).reduce((sum, value) => sum + value, 0);
  const baselineTotalEur = Object.values(baseline.monthlyCosts).reduce((sum, value) => sum + value, 0);
  const projectedCuHours = Math.round((measured.cuHours / W12_DURATION_HOURS * 31 * 24 + cost.monthlyOtherCuHours) * 1e8) / 1e8;
  const reserveCuHours = Math.round((100 - projectedCuHours) * 1e8) / 1e8;
  requireValue([totalEur, baselineTotalEur, projectedCuHours].every(Number.isFinite), 'W12 cost arithmetic overflow');
  requireValue(totalEur < baselineTotalEur, 'W12 total cost must beat equivalent always-awake DB');
  requireValue(totalEur <= 50, 'W12 combined monthly cost exceeds EUR50');
  requireValue(projectedCuHours <= 80 && reserveCuHours >= 20, 'W12 free-quota reserve is exhausted');
  return { totalEur, baselineTotalEur, projectedCuHours, reserveCuHours };
}

export function evaluateW12(value, expectedIdentity, now = Date.now()) {
  try {
    parse(value, 'evidence');
    // Promotion binds release fields; workload identity is additionally bound throughout the report.
    requireValue(expectedIdentity && ['sourceSha', 'tree', 'configRevision', 'manifestDigest', 'environment'].every((key) => value.identity[key] === expectedIdentity[key]), 'W12 release identity mismatch');
    if (expectedIdentity.workloadDigest !== undefined) requireValue(value.identity.workloadDigest === expectedIdentity.workloadDigest, 'W12 workload identity mismatch');
    const measured = checkSegments(value, now, true);
    return { ok: true, findings: [], cost: compareCost(value, measured) };
  } catch (error) {
    return { ok: false, findings: [{ check: 'w12', message: error.message }] };
  }
}

export function startCapture(input, now = Date.now()) {
  parse(input, 'input'); clock(now);
  return { kind: 'gones.w12-capture', version: 1, identity: { ...input.identity }, startedAt: new Date(now).toISOString(), endsAt: new Date(now + W12_DURATION_HOURS * HOUR).toISOString(), segments: [] };
}

export function resumeCapture(state, segment, now = Date.now()) {
  parse(state, 'state'); parse(segment, 'segment');
  const next = { ...state, segments: [...state.segments, segment] };
  parse(next, 'state'); checkSegments(next, now);
  requireValue(now - Date.parse(state.endsAt) <= W12_MAX_AGE_HOURS * HOUR, 'W12 capture is stale');
  return next;
}

export function finalizeCapture(state, cost, now = Date.now()) {
  parse(state, 'state'); parse(cost, 'cost');
  const report = { kind: 'gones.w12-evidence', version: 1, identity: state.identity, startedAt: state.startedAt, endedAt: state.endsAt, segments: state.segments, cost };
  const result = evaluateW12(report, state.identity, now);
  requireValue(result.ok, result.findings.map((finding) => finding.message).join('; '));
  return report;
}

export function readW12Json(path) {
  requireValue(typeof path === 'string' && path.length > 0, 'W12 input path is required');
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    requireValue(stat.isFile() && stat.size <= MAX_BYTES, 'W12 input must be a regular JSON file at most 16 MiB');
    // Bound the read itself: a concurrently growing file must not bypass the stat limit.
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0, count;
    while (length < buffer.length && (count = readSync(descriptor, buffer, length, buffer.length - length, null)) > 0) length += count;
    requireValue(length <= stat.size, 'W12 input changed during read');
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } catch {
    throw new Error('W12 input must be readable regular JSON at most 16 MiB');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...args] = argv;
    requireValue(['start', 'resume', 'finalize'].includes(command) && args.includes('--live'), 'usage: w12-live-soak.mjs <start|resume|finalize> --live --input=<json> --out=<new-json> [--state=<json>]');
    const options = {};
    for (const arg of args) {
      if (arg === '--live') continue;
      const match = /^--(input|out|state)=(.+)$/.exec(arg);
      requireValue(match && !Object.hasOwn(options, match[1]), 'W12 unknown or duplicate argument');
      options[match[1]] = match[2];
    }
    requireValue(options.input && options.out && (command === 'start' ? !options.state : options.state), 'W12 input/output/state arguments do not match command');
    const input = readW12Json(options.input);
    const state = command === 'start' ? null : readW12Json(options.state);
    const output = command === 'start' ? startCapture(input) : command === 'resume' ? resumeCapture(state, input) : finalizeCapture(state, input);
    const serialized = `${JSON.stringify(output, null, 2)}\n`;
    requireValue(Buffer.byteLength(serialized) <= MAX_BYTES, 'W12 output exceeds 16 MiB');
    try { writeFileSync(options.out, serialized, { flag: 'wx', mode: 0o600 }); }
    catch { throw new Error('W12 output requires a new writable path; existing files are never replaced'); }
    console.log(JSON.stringify({ operation: command, status: command === 'finalize' ? 'validated-operator-evidence' : 'capture-pending', providerCalls: 0 }));
    return 0;
  } catch (error) {
    console.error(`W12 refused: ${error.message}`);
    return 2;
  }
}

if (import.meta.filename === process.argv[1]) process.exitCode = main();
