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
  | 'legacyModeCapabilityForbidden'
  | 'runtimeConfigurationInvalid';

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

function requireString(document: Record<string, unknown>, key: string): string | undefined {
  const value = document[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new DataAuthorityConfigurationError('runtimeConfigurationInvalid');
  return value;
}

function requireBoolean(document: Record<string, unknown>, key: string): boolean | undefined {
  const value = document[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new DataAuthorityConfigurationError('runtimeConfigurationInvalid');
  return value;
}

/**
 * C44 — runtime configuration injection.
 *
 * The release artifact is one immutable image that any host may serve on any origin, so the origin
 * and the mode arrive at container start (`/runtime-config.json`), not at build time. The values
 * compiled into `environment` are only the artifact's defaults; a host that injects nothing — the
 * frozen static deployment — keeps exactly the declaration it was built with.
 *
 * A document that exists but is malformed fails closed. Silently ignoring a field would be worse
 * than not shipping the file at all: the browser would fall back to an authority nobody declared.
 */
export function mergeRuntimeDeclaration(baked: DataAuthorityInput, runtime: unknown): DataAuthorityInput {
  if (runtime === null || runtime === undefined) return baked;
  if (typeof runtime !== 'object' || Array.isArray(runtime)) throw new DataAuthorityConfigurationError('runtimeConfigurationInvalid');

  const document = runtime as Record<string, unknown>;
  const features = document['features'];
  if (features !== undefined && features !== null && (typeof features !== 'object' || Array.isArray(features))) {
    throw new DataAuthorityConfigurationError('runtimeConfigurationInvalid');
  }
  const capabilities = (features ?? {}) as Record<string, unknown>;

  return {
    dataMode: requireString(document, 'dataMode') ?? baked.dataMode,
    apiBaseUrl: requireString(document, 'apiBaseUrl') ?? baked.apiBaseUrl,
    features: {
      authV1: requireBoolean(capabilities, 'authV1') ?? baked.features.authV1,
      adminV1: requireBoolean(capabilities, 'adminV1') ?? baked.features.adminV1
    }
  };
}

let resolved: DataAuthority | undefined;

/**
 * Fixes the startup authority decision. Called once by `main.ts`, before the application bootstraps,
 * with the baked declaration merged with whatever the host injected at container start.
 */
export function configureDataAuthority(input: DataAuthorityInput): DataAuthority {
  return (resolved = resolveDataAuthority(input));
}

/**
 * The build's authority decision. Resolved from `environment` on first read and memoized, so the
 * mode observed by dependency injection, routing and every repository is the startup decision.
 */
export function dataAuthority(): DataAuthority {
  return (resolved ??= resolveDataAuthority(environment));
}
