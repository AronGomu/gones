#!/usr/bin/env node
/**
 * Executable V1 acceptance matrix (C43).
 *
 * The V1 architecture docs (`docs/tournament-inscription-calendar-architecture/00..09`) describe a
 * capability surface. A prose checklist claiming those capabilities work is worthless: it can be
 * ticked without running anything. This module turns the matrix into a program.
 *
 * Every non-deferred row must name at least one piece of evidence, and every piece of evidence must
 * resolve to something that actually runs in a committed gate:
 *
 *   vitest    -> a test file inside the `npm run test` include globs
 *   dotnet    -> a test file inside `dotnet test backend/Gones.sln`
 *   cypress   -> a spec that `scripts/full-stack-ci.mjs` really executes (an unwired spec is dead)
 *   script    -> an npm script that exists in package.json
 *   rehearsal -> an exact assertion label present in a committed rehearsal script
 *
 * The `rehearsal` gate is what keeps the matrix honest: a row can only claim a local rehearsal
 * proved something if the literal assertion text exists in the script that runs it.
 *
 * Rows may be `deferred`, but only with a written reason. Deferred rows are the live-infrastructure
 * work this plan explicitly postpones (real OAuth apps, real deliverability, public DNS/CDN,
 * measured RPO/RTO). They are never counted as proved and never allow a live claim.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export const matrixPath = 'ops/acceptance-matrix.json';
export const docsRoot = 'docs/tournament-inscription-calendar-architecture';
export const docFiles = [
  '00-vision-projets.md',
  '01-architecture.md',
  '02-modeles-donnees.md',
  '03-authentification.md',
  '04-utilisateurs-et-organisation.md',
  '05-gestion-tournoi.md',
  '06-gestion-inscription.md',
  '07-notifications.md',
  '08-api-rest.md',
  '09-frontend-angular.md'
];

const gates = new Set(['vitest', 'dotnet', 'cypress', 'script', 'rehearsal']);
const rowStatuses = new Set(['proved', 'unproved', 'deferred']);
const acceptanceStatuses = new Set(['proved', 'deferred', 'release-candidate']);

/** Words that would turn a local rehearsal into a live-infrastructure claim. */
const forbiddenClaims = [/\bRPO\b/, /\bRTO\b/, /\bdeliverab/i, /\bproduction[- ]verified\b/i, /\blive provider\b/i];

function readJson(root, relative) {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'));
}

/**
 * Builds the resolver set once per run. Each resolver answers a single question: "can this evidence
 * target actually execute in a committed gate?" — never "does the file merely exist".
 */
function buildResolvers(root) {
  const packageJson = readJson(root, 'package.json');
  const ciSource = readFileSync(join(root, 'scripts/full-stack-ci.mjs'), 'utf8');
  const vitestConfig = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
  const vitestRoots = [...vitestConfig.matchAll(/'([^']*)\/\*\*\/\*\.test\.ts'/g)].map((match) => `${match[1]}/`);
  const scriptCache = new Map();
  const readScript = (relative) => {
    if (!scriptCache.has(relative)) {
      const path = join(root, relative);
      scriptCache.set(relative, existsSync(path) ? readFileSync(path, 'utf8') : null);
    }
    return scriptCache.get(relative);
  };

  return {
    vitest(target) {
      if (!existsSync(join(root, target))) return `file ${target} does not exist`;
      if (!vitestRoots.some((prefix) => target.startsWith(prefix))) return `${target} is outside the vitest include globs`;
      return null;
    },
    dotnet(target) {
      if (!existsSync(join(root, target))) return `file ${target} does not exist`;
      if (!target.startsWith('backend/tests/')) return `${target} is not a backend test project file`;
      return null;
    },
    cypress(target) {
      if (!existsSync(join(root, target))) return `spec ${target} does not exist`;
      if (!ciSource.includes(basename(target))) return `spec ${target} is not wired into scripts/full-stack-ci.mjs`;
      return null;
    },
    script(target) {
      if (!packageJson.scripts?.[target]) return `npm script "${target}" is not declared in package.json`;
      return null;
    },
    rehearsal(target, detail) {
      const source = readScript(target);
      if (source === null) return `rehearsal script ${target} does not exist`;
      if (!detail) return `rehearsal evidence for ${target} needs the exact assertion text as detail`;
      if (!source.includes(detail)) return `assertion "${detail}" is not present in ${target}`;
      // An assertion nobody runs is not evidence. The script must either be an npm script itself or
      // be driven by one (the journey runner is invoked by the release rehearsal, by service name).
      const stem = basename(target).replace(/\.mjs$/, '');
      const scriptBodies = Object.values(packageJson.scripts ?? {});
      const invokedDirectly = scriptBodies.some((body) => body.includes(target));
      const invokedIndirectly = scriptBodies
        .flatMap((body) => [...body.matchAll(/scripts\/[\w.-]+\.mjs/g)].map((match) => match[0]))
        .some((script) => (readScript(script) ?? '').includes(stem));
      if (!invokedDirectly && !invokedIndirectly) return `${target} is never executed by an npm script`;
      return null;
    }
  };
}

/**
 * Validates the matrix. Returns a structured result so both the CLI and the vitest gate can consume
 * it without re-implementing the rules.
 */
export function evaluateMatrix(root = process.cwd()) {
  const matrix = readJson(root, matrixPath);
  const resolvers = buildResolvers(root);
  const errors = [];
  const rows = matrix.rows ?? [];
  const checklist = matrix.acceptanceChecklist ?? [];

  if (matrix.kind !== 'gones.acceptance-matrix') errors.push(`unexpected matrix kind "${matrix.kind}"`);

  const seenIds = new Set();
  const checklistIds = new Set(checklist.map((entry) => entry.id));
  const backedChecklistIds = new Set();

  for (const row of rows) {
    const where = `row ${row.id ?? '(missing id)'}`;
    if (!row.id) errors.push(`${where}: id is required`);
    if (seenIds.has(row.id)) errors.push(`${where}: duplicate id`);
    seenIds.add(row.id);
    if (!docFiles.includes(row.doc)) errors.push(`${where}: doc "${row.doc}" is not one of the 00-09 architecture documents`);
    if (!row.capability) errors.push(`${where}: capability text is required`);
    if (!rowStatuses.has(row.status)) errors.push(`${where}: status "${row.status}" must be one of ${[...rowStatuses].join(', ')}`);

    for (const claim of forbiddenClaims) {
      if (claim.test(`${row.capability ?? ''} ${row.note ?? ''} ${row.deferredReason ?? ''}`)) {
        // Deferred rows are allowed to name the deferred thing; proved rows may never claim it.
        if (row.status === 'proved') errors.push(`${where}: a proved row may not make a live-infrastructure claim (${claim})`);
      }
    }

    for (const id of row.acceptance ?? []) {
      if (!checklistIds.has(id)) errors.push(`${where}: references unknown acceptance id "${id}"`);
      else if (row.status === 'proved') backedChecklistIds.add(id);
    }

    if (row.status === 'deferred') {
      if (!row.deferredReason) errors.push(`${where}: a deferred row must record why`);
      continue;
    }

    const evidence = row.evidence ?? [];
    if (evidence.length === 0) {
      errors.push(`${where}: unproved — no executable evidence is attached`);
      continue;
    }

    for (const item of evidence) {
      if (!gates.has(item.gate)) {
        errors.push(`${where}: unknown evidence gate "${item.gate}"`);
        continue;
      }
      const failure = resolvers[item.gate](item.target, item.detail);
      if (failure) errors.push(`${where}: ${failure}`);
    }

    if (row.status !== 'proved') errors.push(`${where}: status is "${row.status}" but the row is not deferred`);
  }

  for (const file of docFiles) {
    if (!rows.some((row) => row.doc === file)) errors.push(`document ${file} has no acceptance row`);
    if (!existsSync(join(root, docsRoot, file))) errors.push(`document ${docsRoot}/${file} is missing`);
  }

  for (const entry of checklist) {
    const where = `acceptance ${entry.id ?? '(missing id)'}`;
    if (!acceptanceStatuses.has(entry.status)) errors.push(`${where}: status "${entry.status}" must be one of ${[...acceptanceStatuses].join(', ')}`);
    if (!entry.text) errors.push(`${where}: text is required`);
    if (!['Product', 'Engineering', 'Portable operations'].includes(entry.section)) errors.push(`${where}: unknown section "${entry.section}"`);
    if (entry.status === 'proved' && !backedChecklistIds.has(entry.id)) {
      errors.push(`${where}: marked proved but no proved matrix row references it`);
    }
    if (entry.status !== 'proved' && !entry.reason) errors.push(`${where}: a non-proved acceptance row must record why`);
  }

  const nonDeferred = rows.filter((row) => row.status !== 'deferred');
  const proved = nonDeferred.filter((row) => row.status === 'proved');

  return {
    matrix,
    errors,
    totals: {
      rows: rows.length,
      deferred: rows.length - nonDeferred.length,
      nonDeferred: nonDeferred.length,
      proved: proved.length,
      checklist: checklist.length,
      checklistProved: checklist.filter((entry) => entry.status === 'proved').length
    }
  };
}

if (import.meta.filename === process.argv[1]) {
  const result = evaluateMatrix();
  const byDocument = new Map();
  for (const row of result.matrix.rows ?? []) {
    if (!byDocument.has(row.doc)) byDocument.set(row.doc, []);
    byDocument.get(row.doc).push(row);
  }
  for (const file of docFiles) {
    const rows = byDocument.get(file) ?? [];
    console.log(`\n${file}`);
    for (const row of rows) {
      const mark = row.status === 'proved' ? 'ok  ' : row.status === 'deferred' ? 'defer' : 'FAIL';
      console.log(`  ${mark} ${row.id} — ${row.capability}`);
    }
  }

  const { totals } = result;
  console.log(`\n${totals.proved}/${totals.nonDeferred} non-deferred capability rows proved (${totals.deferred} deferred).`);
  console.log(`${totals.checklistProved}/${totals.checklist} final acceptance checklist rows proved.`);

  if (result.errors.length > 0) {
    console.error(`\nAcceptance matrix failed with ${result.errors.length} finding(s):`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('\nAcceptance matrix passed: every non-deferred capability is backed by an executable local gate.');
}
