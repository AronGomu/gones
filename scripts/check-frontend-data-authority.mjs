#!/usr/bin/env node
/**
 * C42 build-time data-authority gate.
 *
 * The Angular build bakes the declared data authority into `src/environments/environment*.ts`. This
 * script runs right after that substitution so an incoherent image fails at build time instead of
 * shipping and failing in the browser. It mirrors the rules in `src/app/config/data-authority.ts`;
 * `ops/frontend-data-authority.test.ts` feeds the same matrix to both and fails on any drift.
 *
 * Usage: node scripts/check-frontend-data-authority.mjs <environment-file>
 * Exit codes: 0 coherent, 2 incoherent (the error code is printed), 3 unreadable/unparseable file.
 */
import { readFileSync } from 'node:fs';

const DATA_MODES = ['legacy-browser', 'server'];

export function readEnvironmentDeclaration(source) {
  const dataMode = /dataMode:\s*'([^']*)'/.exec(source);
  const apiBaseUrl = /apiBaseUrl:\s*'([^']*)'/.exec(source);
  const authV1 = /authV1:\s*(true|false)/.exec(source);
  const adminV1 = /adminV1:\s*(true|false)/.exec(source);
  if (!dataMode || !apiBaseUrl || !authV1 || !adminV1) return null;
  return {
    dataMode: dataMode[1],
    apiBaseUrl: apiBaseUrl[1],
    features: { authV1: authV1[1] === 'true', adminV1: adminV1[1] === 'true' }
  };
}

/** @returns {string|null} the failure code, or null when the declaration is coherent. */
export function dataAuthorityFailureCode(declaration) {
  if (!DATA_MODES.includes(declaration.dataMode)) return 'dataModeUnknown';
  const apiBaseUrl = declaration.apiBaseUrl.trim().replace(/\/+$/, '');
  const { authV1, adminV1 } = declaration.features;
  if (declaration.dataMode === 'server') {
    if (!apiBaseUrl) return 'serverModeApiBaseUrlMissing';
    if (adminV1 && !authV1) return 'serverModeAdminRequiresAuth';
    return null;
  }
  if (apiBaseUrl) return 'legacyModeApiBaseUrlForbidden';
  if (authV1 || adminV1) return 'legacyModeCapabilityForbidden';
  return null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/check-frontend-data-authority.mjs <environment-file>');
    process.exit(3);
  }
  let declaration;
  try {
    declaration = readEnvironmentDeclaration(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(3);
  }
  if (!declaration) {
    console.error(`${file} does not declare dataMode, apiBaseUrl, authV1 and adminV1.`);
    process.exit(3);
  }
  const failure = dataAuthorityFailureCode(declaration);
  if (failure) {
    console.error(`${file} declares an unsatisfiable data authority: ${failure} (dataMode=${declaration.dataMode}, apiBaseUrl='${declaration.apiBaseUrl}', authV1=${declaration.features.authV1}, adminV1=${declaration.features.adminV1}).`);
    process.exit(2);
  }
  console.log(`${file}: dataMode=${declaration.dataMode} apiBaseUrl='${declaration.apiBaseUrl}' authV1=${declaration.features.authV1} adminV1=${declaration.features.adminV1}`);
}
