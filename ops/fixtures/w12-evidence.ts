// Synthetic test data only. Never an operator evidence template or live proof.
export const HOUR = 3_600_000;
export const start = Date.parse('2026-09-10T00:00:00.000Z');
export const end = start + 72 * HOUR;
export const identity = {
  sourceSha: 'a'.repeat(40), tree: 'b'.repeat(40), configRevision: 'c'.repeat(64),
  manifestDigest: `sha256:${'d'.repeat(64)}`, environment: 'staging',
  workloadDigest: `sha256:${'1'.repeat(64)}`
};
export const input = () => ({ kind: 'gones.w12-input', version: 1, identity: { ...identity }, durationHours: 72 });
export function segment(from = start, to = end) {
  const hours = (to - from) / HOUR;
  return {
    identity: { ...identity }, startedAt: new Date(from).toISOString(), endedAt: new Date(to).toISOString(),
    origin: 'live-provider', evidenceDigest: `sha256:${'2'.repeat(64)}`,
    workloadClasses: ['clustered', 'sparse', 'delayed', 'restart', 'provider-uncertainty', 'duplicate-protection', 'missed-wake'],
    jobClasses: ['notification', 'reminder', 'lifecycle', 'image-expiry', 'image-delete', 'maintenance'],
    jobs: { expected: 12, completed: 12, lost: 0, duplicates: 0, deadlineMisses: 0, failures: 0, maxImmediateLatencyMs: 5000, maxDbColdStartMs: 1000, maxRecoveryLatencyMs: 3_600_000 },
    providerEffects: { expected: 6, observed: 6, duplicates: 0, unresolved: 0 },
    db: { activeHours: hours / 10, cuHours: hours / 40, suspensions: 1 }
  };
}
export function cost() {
  const monthlyCosts = { sharedHostEur: 6, ipv4Eur: 0.5, taxEur: 2, dbEur: 0, dbStorageEur: 0, dbHistoryEur: 0, networkEur: 0, objectEur: 0, telemetryEur: 0, emailEur: 0, registryCiEur: 0, otherEnvironmentEur: 1 };
  return {
    identity: { ...identity }, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(),
    origin: 'live-provider', evidenceDigest: `sha256:${'3'.repeat(64)}`,
    computeUnits: 0.25, monthlyOtherCuHours: 0, paidAutoUpgrade: false, monthlyCosts,
    baseline: { origin: 'live-provider', evidenceDigest: `sha256:${'4'.repeat(64)}`, workloadDigest: identity.workloadDigest,
      durationHours: 72, activeHours: 72, computeUnits: 0.25, cuHours: 18,
      monthlyCosts: { ...monthlyCosts, dbEur: 20 } }
  };
}
export function evidence() {
  return { kind: 'gones.w12-evidence', version: 1, identity: { ...identity }, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(), segments: [segment()], cost: cost() };
}
