// Data authority is declared, never inferred. See src/app/config/data-authority.ts and ADR 0020.
// `server` is the only authority there is: the API database owns the data. The default origin is
// the local Compose API, so `npm run dev` connects to the stack it starts. Container builds
// override these values (see Dockerfile) and the release image injects them at container start.
export const environment = {
  production: false,
  dataMode: 'server',
  apiBaseUrl: 'http://127.0.0.1:5080',
  features: {
    authV1: true,
    adminV1: true
  },
  appVersion: '0.1.0'
} as const;
