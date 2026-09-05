#!/usr/bin/env node
/**
 * Supply-chain and secret audit (C40).
 *
 * Four checks, all offline except `npm audit`:
 *  1. Advisories      — `npm audit --json`; high/critical fail unless listed in ACCEPTED_ADVISORIES.
 *  2. Licenses        — every installed package's declared license must be in ALLOWED_LICENSES.
 *  3. Install scripts — every dependency with pre/post/install lifecycle scripts must be acknowledged.
 *  4. Secrets         — literal credentials in tracked source, and secret-shaped values in the built
 *                       client bundle (`dist/`) when one exists.
 *
 * Reports are written to `reports/` (gitignored) so CI can retain them as artifacts:
 *   reports/supply-chain-audit.json   machine-readable
 *   reports/supply-chain-audit.md     human-readable summary
 *
 * Exit code 0 = clean, 1 = at least one unaccepted finding.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const reportsDirectory = join(root, 'reports');

/**
 * Advisories reviewed and accepted for V1, with the reason. Empty = no accepted risk.
 *
 * Nothing is accepted today. Transitive advisories are resolved by pinning instead, via
 * `overrides` in package.json — currently `qs` and `undici` (the latter scoped to `@angular/build`
 * and `jsdom`, whose own fixed releases are only available behind an Angular major upgrade).
 * Remaining `moderate` findings sit in dev-only Angular CLI tooling and are reported, not blocking.
 */
const ACCEPTED_ADVISORIES = new Set([]);

/** SPDX identifiers permitted for a permissively-licensed product. Copyleft is rejected on purpose. */
const ALLOWED_LICENSES = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense',
  'CC-BY-4.0', 'CC-BY-3.0', 'BlueOak-1.0.0', 'Python-2.0', 'WTFPL', 'MPL-2.0', 'Zlib',
  'Artistic-2.0', 'BSD', 'AFL-2.1', 'MIT-0', 'UNKNOWN-BUNDLED'
]);

/**
 * Packages whose install scripts are known, reviewed, and required to build the app.
 * Anything new appearing here is a supply-chain change that must be reviewed before it is pinned.
 */
const ACKNOWLEDGED_INSTALL_SCRIPTS = new Set([
  'cypress', 'esbuild', 'lmdb', 'msgpackr-extract', 'nice-napi', 'puppeteer', 'unrs-resolver', '@parcel/watcher'
]);

const SECRET_PATTERNS = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'brevo-api-key', pattern: /\bxkeysib-[0-9a-f]{64}-[A-Za-z0-9]{16}\b/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  // DSN form only (`;Password=`), so minified `obj.password=x` in a bundle is not a false positive.
  { id: 'connection-password', pattern: /(?:^|;)\s*(?:Password|Pwd)\s*=\s*(?!local-|test-|\$\{|<)[^;"'\s]{12,}/im }
];

/** Patterns strict enough to run against minified output without false positives. */
const BUNDLE_SECRET_RULES = new Set(['private-key', 'aws-access-key', 'github-token', 'slack-token', 'google-api-key', 'brevo-api-key', 'jwt']);

const SOURCE_ROOTS = ['src', 'scripts', 'backend/src', 'deploy', 'cypress'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.cs', '.json', '.yaml', '.yml', '.conf', '.html', '.css', '.sql']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'bin', 'obj', 'dist', '.git', '.angular', 'generated']);

function walk(directory, onFile) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function auditAdvisories() {
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', cwd: root });
  const output = result.stdout?.trim();
  if (!output) {
    return { ran: false, reason: result.stderr?.trim().slice(0, 400) || 'npm audit produced no output', findings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { ran: false, reason: 'npm audit output was not JSON (offline registry?)', findings: [] };
  }
  const findings = [];
  for (const [name, advisory] of Object.entries(parsed.vulnerabilities ?? {})) {
    if (!['high', 'critical'].includes(advisory.severity)) continue;
    const ids = (advisory.via ?? []).filter((via) => typeof via === 'object').map((via) => `GHSA:${via.source ?? via.url ?? 'unknown'}`);
    if (ids.some((id) => ACCEPTED_ADVISORIES.has(id))) continue;
    findings.push({ package: name, severity: advisory.severity, range: advisory.range, via: ids });
  }
  const metadata = parsed.metadata?.vulnerabilities ?? {};
  return { ran: true, totals: metadata, findings };
}

function readInstalledPackages() {
  const modules = join(root, 'node_modules');
  const packages = [];
  if (!existsSync(modules)) return packages;
  const visit = (directory, scope) => {
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith('.')) continue;
      const full = join(directory, entry);
      if (!statSync(full).isDirectory()) continue;
      if (!scope && entry.startsWith('@')) {
        visit(full, entry);
        continue;
      }
      const manifestPath = join(full, 'package.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        packages.push({
          name: manifest.name ?? (scope ? `${scope}/${entry}` : entry),
          version: manifest.version ?? 'unknown',
          license: normalizeLicense(manifest),
          scripts: Object.keys(manifest.scripts ?? {}).filter((script) => ['preinstall', 'install', 'postinstall'].includes(script))
        });
      } catch {
        // Unreadable manifest: reported by the license check as UNKNOWN.
        packages.push({ name: scope ? `${scope}/${entry}` : entry, version: 'unknown', license: 'UNKNOWN', scripts: [] });
      }
      const nested = join(full, 'node_modules');
      if (existsSync(nested)) visit(nested, undefined);
    }
  };
  visit(modules, undefined);
  return packages;
}

function normalizeLicense(manifest) {
  const license = manifest.license ?? manifest.licenses;
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) return license.map((entry) => entry.type ?? entry).join(' OR ');
  if (license && typeof license === 'object') return license.type ?? 'UNKNOWN';
  return 'UNKNOWN';
}

function licenseAllowed(license) {
  // Accept SPDX expressions when every named license is allowed.
  return license
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => ALLOWED_LICENSES.has(part));
}

function auditSecrets() {
  const findings = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    walk(join(root, sourceRoot), (file) => {
      const extension = file.slice(file.lastIndexOf('.'));
      if (!SOURCE_EXTENSIONS.has(extension)) return;
      const relativePath = relative(root, file);
      // The audit script itself contains the detection patterns.
      if (relativePath === 'scripts/audit-supply-chain.mjs') return;
      const content = readFileSync(file, 'utf8');
      for (const { id, pattern } of SECRET_PATTERNS) {
        const match = pattern.exec(content);
        if (!match) continue;
        const line = content.slice(0, match.index).split('\n').length;
        findings.push({ rule: id, file: relativePath, line });
      }
    });
  }
  return findings;
}

function auditClientBundle() {
  const dist = join(root, 'dist');
  const findings = [];
  if (!existsSync(dist)) return { scanned: false, findings };
  walk(dist, (file) => {
    if (!file.endsWith('.js') && !file.endsWith('.html') && !file.endsWith('.json')) return;
    const content = readFileSync(file, 'utf8');
    for (const { id, pattern } of SECRET_PATTERNS) {
      if (BUNDLE_SECRET_RULES.has(id) && pattern.test(content)) findings.push({ rule: id, file: relative(root, file) });
    }
    // Server-only configuration keys must never be inlined into the browser bundle.
    for (const key of ['GONES_AUTH_SIGNING_KEY', 'GONES_DB_CONNECTION', 'GONES_GOOGLE_CLIENT_SECRET', 'GONES_FACEBOOK_CLIENT_SECRET', 'GONES_BREVO_API_KEY']) {
      if (content.includes(key)) findings.push({ rule: 'server-only-config-in-bundle', file: relative(root, file), key });
    }
  });
  return { scanned: true, findings };
}

const advisories = auditAdvisories();
const packages = readInstalledPackages();
const licenseFindings = packages
  .filter((entry) => !licenseAllowed(entry.license))
  .map((entry) => ({ package: entry.name, version: entry.version, license: entry.license }));
const installScriptFindings = packages
  .filter((entry) => entry.scripts.length > 0 && !ACKNOWLEDGED_INSTALL_SCRIPTS.has(entry.name))
  .map((entry) => ({ package: entry.name, version: entry.version, scripts: entry.scripts }));
const secretFindings = auditSecrets();
const bundle = auditClientBundle();

const report = {
  generatedAt: new Date().toISOString(),
  packageCount: packages.length,
  advisories,
  licenses: { allowed: [...ALLOWED_LICENSES].sort(), findings: licenseFindings },
  installScripts: { acknowledged: [...ACKNOWLEDGED_INSTALL_SCRIPTS].sort(), findings: installScriptFindings },
  secrets: secretFindings,
  clientBundle: bundle
};

const blocking =
  advisories.findings.length +
  licenseFindings.length +
  installScriptFindings.length +
  secretFindings.length +
  bundle.findings.length;

mkdirSync(reportsDirectory, { recursive: true });
writeFileSync(join(reportsDirectory, 'supply-chain-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

function section(title, findings, render) {
  if (!findings.length) return `### ${title}\n\nNo findings.\n`;
  return `### ${title}\n\n${findings.map((finding) => `- ${render(finding)}`).join('\n')}\n`;
}

const markdown = [
  '# Supply-chain and secret audit',
  '',
  `Generated: ${report.generatedAt}`,
  `Packages scanned: ${report.packageCount}`,
  `Result: ${blocking === 0 ? 'PASS' : `FAIL (${blocking} finding(s))`}`,
  '',
  advisories.ran
    ? `### Advisories\n\nTotals: ${JSON.stringify(advisories.totals)}\n\n${advisories.findings.length ? advisories.findings.map((finding) => `- ${finding.package} (${finding.severity}) ${finding.range}`).join('\n') : 'No unaccepted high/critical advisories.'}\n`
    : `### Advisories\n\nSkipped: ${advisories.reason}\n`,
  section('Licenses', licenseFindings, (finding) => `${finding.package}@${finding.version}: ${finding.license}`),
  section('Install scripts', installScriptFindings, (finding) => `${finding.package}@${finding.version}: ${finding.scripts.join(', ')}`),
  section('Secret literals in source', secretFindings, (finding) => `${finding.file}:${finding.line} matched ${finding.rule}`),
  bundle.scanned
    ? section('Client bundle', bundle.findings, (finding) => `${finding.file} matched ${finding.rule}${finding.key ? ` (${finding.key})` : ''}`)
    : '### Client bundle\n\nSkipped: no `dist/` build present. Run `npm run build` first to include this check.\n'
].join('\n');
writeFileSync(join(reportsDirectory, 'supply-chain-audit.md'), `${markdown}\n`);

console.log(markdown);
if (!advisories.ran) console.warn(`\nWARNING: advisory check did not run (${advisories.reason}).`);
if (blocking > 0) {
  console.error(`\nSupply-chain audit failed with ${blocking} finding(s). See reports/supply-chain-audit.md.`);
  process.exit(1);
}
console.log('\nSupply-chain audit passed. Reports written to reports/.');
