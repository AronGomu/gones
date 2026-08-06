// Data authority is declared, never inferred. See src/app/config/data-authority.ts and ADR 0019.
// `legacy-browser` is the frozen static deployment default: browser localStorage owns the data and
// no server capability may be enabled. Container builds override these values (see Dockerfile).
export const environment = {
  production: true,
  dataMode: 'legacy-browser',
  apiBaseUrl: '',
  features: {
    authV1: false,
    adminV1: false
  },
  appVersion: '0.1.0'
} as const;
