#!/usr/bin/env node
/**
 * Immutable staging promotion gate.
 *
 * Pure evaluator: callers provide candidate provenance, staging evidence and target identity.
 * It never reads credentials, talks to a registry or trusts a mutable "latest" result.
 */
import { existsSync, readFileSync } from 'node:fs';
import { evaluateW12, readW12Json } from './w12-live-soak.mjs';

export const PROMOTION_ARTIFACTS = Object.freeze(['api', 'worker', 'migrator', 'backup', 'frontend']);
const SHA = /^[0-9a-f]{40}$/;
const TREE = /^[0-9a-f]{40,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const required = (value, label, fail) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} is missing`);
  return value;
};

/**
 * @param {object} context
 * @returns {{ok: boolean, findings: {check: string, message: string}[]}}
 */
export function evaluateDeployment(context) {
  const findings = [];
  const fail = (check, message) => findings.push({ check, message });
  const candidate = context?.candidate ?? {};
  const manifest = context?.manifest ?? {};
  const staging = context?.staging ?? {};
  const target = context?.target ?? {};

  const sourceSha = required(candidate.sourceSha, 'candidate source SHA', (message) => fail('source', message));
  const sourceTree = required(candidate.tree, 'candidate source tree', (message) => fail('source', message));
  const configRevision = required(candidate.configRevision, 'candidate config revision', (message) => fail('config', message));

  if (sourceSha && !SHA.test(sourceSha)) fail('source', `candidate source SHA is not a commit SHA: ${sourceSha}`);
  if (sourceTree && !TREE.test(sourceTree)) fail('source', `candidate source tree is not a tree identity: ${sourceTree}`);
  if (manifest.sourceSha !== sourceSha) fail('provenance', `manifest source SHA ${manifest.sourceSha ?? 'missing'} differs from candidate ${sourceSha}`);
  if (manifest.tree !== sourceTree) fail('provenance', `manifest source tree ${manifest.tree ?? 'missing'} differs from candidate ${sourceTree}`);
  if (manifest.configRevision !== configRevision) fail('config', `manifest config revision ${manifest.configRevision ?? 'missing'} differs from candidate ${configRevision}`);

  const images = new Map((manifest.images ?? []).map((image) => [image.name, image]));
  for (const name of PROMOTION_ARTIFACTS) {
    const image = images.get(name);
    if (!image) {
      fail('provenance', `${name} is missing from immutable registry manifest`);
      continue;
    }
    if (!DIGEST.test(image.digest ?? '')) fail('provenance', `${name} has no immutable registry digest`);
    if (image.signed !== true) fail('signature', `${name} has no verified keyless signature`);
    if (image.provenance !== true) fail('provenance', `${name} has no verified build provenance`);
    if (image.sbom !== true) fail('provenance', `${name} has no verified SBOM`);
    if ((image.critical ?? 0) !== 0) fail('provenance', `${name} has unresolved CRITICAL findings`);
  }

  const sameIdentity = (scope, value, expected) => {
    if (value !== expected) fail(scope, `${scope} identity ${value ?? 'missing'} differs from ${expected}`);
  };
  sameIdentity('staging source SHA', staging.sourceSha, sourceSha);
  sameIdentity('staging source tree', staging.tree, sourceTree);
  sameIdentity('staging config revision', staging.configRevision, configRevision);
  sameIdentity('staging manifest', staging.manifestDigest, manifest.manifestDigest);
  if (staging.status !== 'passed') fail('staging', `staging gate status is ${staging.status ?? 'missing'}`);
  if (staging.migrationExitCode !== 0) fail('migration', `staging migration exited ${staging.migrationExitCode ?? 'missing'}; rollout is blocked`);
  if (staging.deploymentsActive !== 0) fail('serialization', `staging has ${staging.deploymentsActive ?? 'unknown'} active deployment(s)`);
  if (staging.serialized !== true) fail('serialization', 'staging deployment was not serialized');

  sameIdentity('target source SHA', target.sourceSha, sourceSha);
  sameIdentity('target source tree', target.tree, sourceTree);
  sameIdentity('target config revision', target.configRevision, configRevision);
  sameIdentity('target manifest', target.manifestDigest, manifest.manifestDigest);
  if (target.rebuild === true) fail('immutable', 'target promotion requests a rebuild instead of reusing tested digests');
  if (target.changed === true) fail('immutable', 'candidate or config changed after staging evidence; fresh gate required');

  const current = context?.current ?? null;
  if (current) {
    if (current.tree !== sourceTree) fail('source', `main source tree ${current.tree ?? 'missing'} differs from staged tree ${sourceTree}`);
    if (current.configRevision !== configRevision) fail('config', `main config revision ${current.configRevision ?? 'missing'} differs from staged config ${configRevision}`);
  }

  return { ok: findings.length === 0, findings };
}

/** Promotion always requires W12; the immediate deployment gate never grants promotion. */
export function evaluatePromotion(context, now = Date.now()) {
  const { findings } = evaluateDeployment(context);
  const candidate = context?.candidate ?? {};
  const w12 = evaluateW12(context?.w12, {
    sourceSha: candidate.sourceSha, tree: candidate.tree, configRevision: candidate.configRevision,
    manifestDigest: context?.manifest?.manifestDigest, environment: 'staging'
  }, now);
  findings.push(...w12.findings);
  return { ok: findings.length === 0, findings };
}

if (import.meta.filename === process.argv[1]) {
  const argument = (name) => process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  const path = argument('evidence');
  if (!path || !existsSync(path)) {
    console.error('Promotion evidence file is required: --evidence=<path>');
    process.exit(2);
  }
  let context;
  try {
    context = JSON.parse(readFileSync(path, 'utf8'));
    const w12Path = argument('w12');
    if (w12Path) context.w12 = readW12Json(w12Path);
  } catch (error) {
    console.error(`Could not read promotion evidence: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const result = evaluatePromotion(context);
  if (result.ok) {
    console.log('Promotion checks passed: source, config, signatures, migration, staging gate, live W12 evidence and immutable digests match.');
    process.exit(0);
  }
  for (const finding of result.findings) console.error(`FAIL ${finding.check}: ${finding.message}`);
  console.error(`Promotion checks refused candidate: ${result.findings.length} finding(s).`);
  process.exit(1);
}
