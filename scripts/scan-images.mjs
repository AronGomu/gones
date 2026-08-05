#!/usr/bin/env node
/**
 * Vulnerability and secret scanning for the release artifacts (C41).
 *
 * Both scanners run as digest-pinned containers against the local daemon, so the same command works
 * on a developer machine and in CI with no host installation. CRITICAL findings fail the run; HIGH
 * and below are reported so they can be triaged without blocking a rehearsal.
 *
 * Run `npm run images:build` first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_IMAGES, TOOL_IMAGES, dockerSocket, run, tagFor } from './release-images.mjs';

const root = process.cwd();
const outputDirectory = join(root, 'reports', 'images');
const reference = process.env.GONES_IMAGE_REFERENCE ?? 'local';
mkdirSync(outputDirectory, { recursive: true });

const summary = { generatedAt: new Date().toISOString(), images: [], secrets: null };
let blocking = 0;

for (const image of RELEASE_IMAGES) {
  const tag = tagFor(image.name, reference);
  console.log(`\n=== trivy ${tag} ===`);
  const result = run('docker', [
    'run', '--rm',
    '-v', `${dockerSocket()}:/var/run/docker.sock`,
    TOOL_IMAGES.trivy,
    'image', '--scanners', 'vuln', '--quiet', '--format', 'json', '--timeout', '15m', tag
  ], { maxBuffer: 512 * 1024 * 1024 });

  if (result.status !== 0 || !result.stdout.trim().startsWith('{')) {
    console.error(result.stderr?.trim().slice(0, 2000));
    summary.images.push({ image: image.name, tag, scanned: false, reason: (result.stderr || '').trim().slice(0, 500) });
    blocking++;
    continue;
  }

  const report = JSON.parse(result.stdout);
  writeFileSync(join(outputDirectory, `trivy-${image.name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const findings = (report.Results ?? []).flatMap((entry) => entry.Vulnerabilities ?? []);
  const counts = findings.reduce((accumulator, finding) => {
    accumulator[finding.Severity] = (accumulator[finding.Severity] ?? 0) + 1;
    return accumulator;
  }, {});
  const critical = findings.filter((finding) => finding.Severity === 'CRITICAL');
  summary.images.push({
    image: image.name,
    tag,
    scanned: true,
    counts,
    critical: critical.map((finding) => ({ id: finding.VulnerabilityID, package: finding.PkgName, installed: finding.InstalledVersion, fixed: finding.FixedVersion ?? null }))
  });
  console.log(`  ${JSON.stringify(counts)}`);
  if (critical.length > 0) {
    blocking += critical.length;
    for (const finding of critical) console.error(`  CRITICAL ${finding.VulnerabilityID} ${finding.PkgName}@${finding.InstalledVersion}`);
  }
}

console.log('\n=== gitleaks (working tree) ===');
const secrets = run('docker', [
  'run', '--rm',
  '-v', `${root}:/repo:ro`,
  TOOL_IMAGES.gitleaks,
  'dir', '/repo', '--config', '/repo/deploy/security/gitleaks.toml', '--redact', '--no-banner', '--exit-code', '1',
  '--report-format', 'json', '--report-path', '/dev/stdout'
], { maxBuffer: 64 * 1024 * 1024 });
const leaks = secrets.stdout.trim().startsWith('[') ? JSON.parse(secrets.stdout) : [];
summary.secrets = { scanned: secrets.status === 0 || leaks.length > 0, findings: leaks.length };
if (leaks.length > 0) {
  blocking += leaks.length;
  for (const leak of leaks) console.error(`  LEAK ${leak.RuleID} ${leak.File}:${leak.StartLine}`);
} else if (secrets.status !== 0 && secrets.status !== 1) {
  console.error(secrets.stderr?.trim().slice(0, 2000));
  summary.secrets.scanned = false;
  blocking++;
} else {
  console.log('  no secrets detected');
}

writeFileSync(join(outputDirectory, 'scan-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
if (blocking > 0) {
  console.error(`\nImage scan failed with ${blocking} blocking finding(s). See reports/images/.`);
  process.exit(1);
}
console.log('\nImage scan passed: no CRITICAL vulnerability and no detected secret.');
