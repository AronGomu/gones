import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const api = 'http://127.0.0.1:5080';
const password = 'local-smoke-password';
const nextPassword = 'local-smoke-password-next';

function docker(args) {
  const result = spawnSync('docker', ['compose', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

async function post(path, body, { token, cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  return fetch(`${api}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
}

async function clearSink() {
  docker(['exec', '-T', 'worker', 'sh', '-ec', 'rm -rf /tmp/gones-email-sink && mkdir -p /tmp/gones-email-sink']);
}

async function actionToken() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const raw = docker(['exec', '-T', 'worker', 'sh', '-ec', "find /tmp/gones-email-sink -maxdepth 1 -type f -name '*.json' -exec cat {} \\;"]);
    const match = raw.match(/https:\/\/[^\s<]+[?&]token=[A-Za-z0-9_%.-]+/);
    if (match) return new URL(match[0].replace(/&amp;/g, '&')).searchParams.get('token');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Action link did not reach local file sink. Set GONES_EMAIL_SINK_INCLUDE_ACTION_LINKS=true.');
}

async function register(email, username) {
  await clearSink();
  const response = await post('/api/auth/register', { email, username, password, firstName: 'Local', lastName: 'Smoke' });
  if (response.status !== 202) throw new Error(`register failed: ${response.status} ${await response.text()}`);
  return actionToken();
}

async function login(email, value = password) {
  const response = await post('/api/auth/login', { email, password: value, deviceLabel: 'C10 smoke' });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  const body = await response.json();
  return { accessToken: body.accessToken, cookie: response.headers.get('set-cookie').split(';', 1)[0] };
}

const suffix = Date.now().toString(36);
const email = `c10-${suffix}@example.test`;
const verifyToken = await register(email, `C10${suffix}`);
let response = await post('/api/auth/verify-email', { token: verifyToken });
if (response.status !== 204) throw new Error(`verify failed: ${response.status}`);

const supersededEmail = `c10-superseded-${suffix}@example.test`;
const oldToken = await register(supersededEmail, `C10S${suffix}`);
await clearSink();
response = await post('/api/auth/resend-verification', { email: supersededEmail });
if (response.status !== 202) throw new Error(`resend failed: ${response.status}`);
const newestToken = await actionToken();
if ((await post('/api/auth/verify-email', { token: oldToken })).status !== 400) throw new Error('superseded verification token accepted');
if ((await post('/api/auth/verify-email', { token: newestToken })).status !== 204) throw new Error('newest verification token rejected');

const expiredEmail = `c10-expired-${suffix}@example.test`;
const expiredToken = await register(expiredEmail, `C10E${suffix}`);
const expiredHash = createHash('sha256').update(expiredToken).digest('hex');
docker(['exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE account_action_tokens SET expires_at = now() WHERE token_hash = '${expiredHash}';`]);
if ((await post('/api/auth/verify-email', { token: expiredToken })).status !== 400) throw new Error('expired verification token accepted');

const session = await login(email);
await clearSink();
const knownForgot = await post('/api/auth/forgot-password', { email });
const unknownForgot = await post('/api/auth/forgot-password', { email: `missing-${suffix}@example.test` });
if (knownForgot.status !== 202 || unknownForgot.status !== 202 || await knownForgot.text() !== await unknownForgot.text()) throw new Error('forgot response enumerates account');
const resetToken = await actionToken();
if ((await post('/api/auth/reset-password', { token: resetToken, password: nextPassword })).status !== 204) throw new Error('reset failed');
if ((await post('/api/auth/reset-password', { token: resetToken, password })).status !== 400) throw new Error('reset token replay accepted');
if ((await post('/api/auth/refresh', {}, { cookie: session.cookie })).status !== 401) throw new Error('password reset did not revoke refresh family');

const changedSession = await login(email, nextPassword);
const changedEmail = `c10-changed-${suffix}@example.test`;
await clearSink();
response = await post('/api/users/me/email-change', { newEmail: changedEmail, currentPassword: nextPassword }, { token: changedSession.accessToken });
if (response.status !== 202) throw new Error(`email-change request failed: ${response.status}`);
const changeToken = await actionToken();
if ((await post('/api/auth/confirm-email-change', { token: changeToken })).status !== 204) throw new Error('email-change confirmation failed');
await login(changedEmail, nextPassword);

let limited;
for (let attempt = 0; attempt < 6; attempt++) limited = await post('/api/auth/resend-verification', { email: `rate-${suffix}@example.test` });
if (limited.status !== 429 || !limited.headers.get('retry-after')) throw new Error('rate limit lacks 429/Retry-After');

console.log('C10 account lifecycle smoke passed: verify expiry/newest, generic forgot, single-use reset/revocation, email change, rate limit.');
