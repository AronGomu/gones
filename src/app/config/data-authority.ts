import { environment } from '../../environments/environment';

/**
 * C42 — explicit legacy versus server data authority.
 *
 * There is exactly one data authority per build and it is declared, never inferred:
 *
 * - `legacy-browser` — the frozen static deployment. Browser `localStorage` owns League, Live and
 *   CalendarEvent source data. No API base URL, no auth, no admin, no Calendar V1 server surface.
 *   Kept only so the existing static site keeps working and can export its migration bundle.
 * - `server` — the API database is the single authority. The browser keeps language, view, filter
 *   and public read cache only; it never holds canonical source data.
 *
 * There is no third state and no fallback: a build that cannot satisfy its declared mode fails
 * closed at startup rather than silently degrading to the browser store. The decision is resolved
 * once and memoized, so nothing can switch authority while the app is running.
 */

export const DATA_MODES = ['legacy-browser', 'server'] as const;

export type DataMode = (typeof DATA_MODES)[number];

export type DataAuthorityErrorCode =
  | 'dataModeUnknown'
  | 'serverModeApiBaseUrlMissing'
  | 'serverModeAdminRequiresAuth'
  | 'legacyModeApiBaseUrlForbidden'
  | 'legacyModeCapabilityForbidden';

export interface DataAuthorityCapabilityFlags {
  readonly authV1: boolean;
  readonly adminV1: boolean;
}

export interface DataAuthorityInput {
  readonly dataMode: string;
  readonly apiBaseUrl: string;
  readonly features: DataAuthorityCapabilityFlags;
}

export interface DataAuthority {
  readonly mode: DataMode;
  readonly serverAuthority: boolean;
  readonly legacyBrowserAuthority: boolean;
  /** Empty in legacy mode; a normalized absolute origin in server mode. */
  readonly apiBaseUrl: string;
  readonly authV1: boolean;
  readonly adminV1: boolean;
}

export class DataAuthorityConfigurationError extends Error {
  constructor(readonly code: DataAuthorityErrorCode) {
    super(`Gones data authority configuration rejected: ${code}.`);
    this.name = 'DataAuthorityConfigurationError';
  }
}

function isDataMode(value: string): value is DataMode {
  return (DATA_MODES as readonly string[]).includes(value);
}

/** Validate one build configuration into a frozen authority decision, or fail closed. */
export function resolveDataAuthority(input: DataAuthorityInput): DataAuthority {
  if (!isDataMode(input.dataMode)) throw new DataAuthorityConfigurationError('dataModeUnknown');

  const apiBaseUrl = input.apiBaseUrl.trim().replace(/\/+$/, '');
  const { authV1, adminV1 } = input.features;

  if (input.dataMode === 'server') {
    if (!apiBaseUrl) throw new DataAuthorityConfigurationError('serverModeApiBaseUrlMissing');
    if (adminV1 && !authV1) throw new DataAuthorityConfigurationError('serverModeAdminRequiresAuth');
  } else {
    if (apiBaseUrl) throw new DataAuthorityConfigurationError('legacyModeApiBaseUrlForbidden');
    if (authV1 || adminV1) throw new DataAuthorityConfigurationError('legacyModeCapabilityForbidden');
  }

  return Object.freeze<DataAuthority>({
    mode: input.dataMode,
    serverAuthority: input.dataMode === 'server',
    legacyBrowserAuthority: input.dataMode === 'legacy-browser',
    apiBaseUrl,
    authV1,
    adminV1
  });
}

let resolved: DataAuthority | undefined;

/**
 * The build's authority decision. Resolved from `environment` on first read and memoized, so the
 * mode observed by dependency injection, routing and every repository is the startup decision.
 */
export function dataAuthority(): DataAuthority {
  return (resolved ??= resolveDataAuthority(environment));
}
