// Data authority is declared, never inferred. See src/app/config/data-authority.ts and ADR 0020.
// `server` is the only authority there is: the API database owns the data. The origin below is the
// artifact's default only — the release image injects the real one at container start, and the
// release preflight refuses a candidate that can serve nothing but this default.
export const environment = {
  production: true,
  dataMode: 'server',
  apiBaseUrl: 'http://127.0.0.1:5080',
  features: {
    authV1: true,
    adminV1: true
  },
  appVersion: '0.1.0'
} as const;
