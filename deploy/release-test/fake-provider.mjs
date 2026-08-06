// Local OAuth/OIDC and Brevo fakes for the C41 release rehearsal.
//
// They exist so the release-mode stack can exercise the External identity provider and the Brevo
// email transport without a single live credential, domain or callback registration. Both speak TLS
// with the rehearsal's private CA, because the application refuses cleartext for either integration.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const role = process.env.GONES_FIXTURE_ROLE;
const host = process.env.GONES_FIXTURE_HOST ?? 'localhost';
const port = Number(process.env.GONES_FIXTURE_PORT ?? 8443);
const webhookBase = process.env.GONES_FIXTURE_WEBHOOK_BASE;
const webhookTokenFile = process.env.GONES_FIXTURE_WEBHOOK_TOKEN_FILE;

/**
 * The local email sink. It keeps the rendered message, because the rehearsal has to read the
 * verification link out of it exactly the way a human would read it out of an inbox. Nothing here
 * ever leaves the isolated network: the address space is `.invalid` and there is no default route.
 */
const received = [];
const webhooks = [];
/**
 * Failure injection, so the retry/dead-letter and acceptance-uncertain paths can be exercised
 * without waiting for a real provider to break.
 *
 *   failSends        - reply with `statusCode` (a transient failure) this many more times
 *   invalidResponses - accept with a body that carries no message id, which is exactly the
 *                      "we do not know whether it was accepted" case the outbox holds for operator
 *                      reconciliation rather than silently resending
 */
const faults = { remainingFailures: 0, statusCode: 503, invalidResponses: 0 };

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Replays a provider delivery event back through the TLS edge, exactly as Brevo would. */
async function deliverWebhook(tag, messageId) {
  if (!webhookBase || !webhookTokenFile) return;
  const token = readFileSync(webhookTokenFile, 'utf8').trim();
  const body = JSON.stringify({
    event: 'delivered',
    id: Math.floor(Math.random() * 1_000_000_000),
    'message-id': messageId,
    tag,
    ts_event: Math.floor(Date.now() / 1000)
  });
  try {
    const response = await fetch(`${webhookBase}/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    });
    webhooks.push({ tag, messageId, status: response.status });
    console.log(`fake-brevo: webhook replayed tag=${tag} status=${response.status}`);
  } catch (error) {
    webhooks.push({ tag, messageId, status: 0, error: String(error) });
    console.error(`fake-brevo: webhook failed tag=${tag} error=${String(error)}`);
  }
}

async function handleIdentity(request, response, url) {
  if (url.pathname === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirectUri) return json(response, 400, { error: 'invalid_request' });
    console.log(`fake-identity: authorize redirect_uri=${redirectUri}`);
    const target = new URL(redirectUri);
    target.searchParams.set('code', `fake-code-${randomUUID()}`);
    if (state) target.searchParams.set('state', state);
    response.writeHead(302, { location: target.toString() });
    return response.end();
  }
  if (url.pathname === '/token' && request.method === 'POST') {
    await readBody(request);
    return json(response, 200, {
      access_token: `fake-access-${randomUUID()}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid email profile'
    });
  }
  if (url.pathname === '/userinfo') {
    return json(response, 200, {
      sub: 'release-test-subject',
      id: 'release-test-subject',
      email: 'release-test@release-test.invalid',
      email_verified: true,
      given_name: 'Release',
      family_name: 'Test',
      first_name: 'Release',
      last_name: 'Test'
    });
  }
  if (url.pathname === '/_fixture/received') return json(response, 200, { received });
  return json(response, 404, { error: 'not_found' });
}

async function handleBrevo(request, response, url) {
  if (url.pathname === '/v3/smtp/email' && request.method === 'POST') {
    if (!request.headers['api-key']) return json(response, 401, { message: 'missing api key' });
    const body = JSON.parse((await readBody(request)) || '{}');
    if (faults.remainingFailures > 0) {
      faults.remainingFailures--;
      console.log(`fake-brevo: injected failure status=${faults.statusCode} remaining=${faults.remainingFailures}`);
      return json(response, faults.statusCode, { message: 'injected provider failure' });
    }
    if (faults.invalidResponses > 0) {
      faults.invalidResponses--;
      console.log(`fake-brevo: injected acceptance-uncertain response remaining=${faults.invalidResponses}`);
      return json(response, 201, {});
    }
    const tag = Array.isArray(body.tags) ? body.tags[0] : undefined;
    const messageId = `<fake-${randomUUID()}@release-test.invalid>`;
    received.push({
      tag,
      subject: body.subject,
      to: body.to?.[0]?.email,
      messageId,
      htmlContent: body.htmlContent ?? '',
      textContent: body.textContent ?? ''
    });
    // The message body stays in memory only; logging it would leak an action token into stdout.
    console.log(`fake-brevo: accepted send tag=${tag} messageId=${messageId}`);
    json(response, 201, { messageId });
    if (tag) await deliverWebhook(tag, messageId);
    return undefined;
  }
  if (url.pathname === '/_fixture/mode' && request.method === 'POST') {
    const body = JSON.parse((await readBody(request)) || '{}');
    faults.remainingFailures = Number(body.failSends ?? 0);
    faults.statusCode = Number(body.statusCode ?? 503);
    faults.invalidResponses = Number(body.invalidResponses ?? 0);
    console.log(`fake-brevo: fault mode failSends=${faults.remainingFailures} invalid=${faults.invalidResponses} status=${faults.statusCode}`);
    return json(response, 200, { faults });
  }
  if (url.pathname === '/_fixture/received') return json(response, 200, { received, webhooks, faults });
  return json(response, 404, { error: 'not_found' });
}

const server = createServer(
  { key: readFileSync(`/certs/${host}.key`), cert: readFileSync(`/certs/${host}.pem`) },
  (request, response) => {
    const url = new URL(request.url ?? '/', `https://${host}`);
    const handler = role === 'identity' ? handleIdentity : handleBrevo;
    handler(request, response, url).catch(() => {
      if (!response.headersSent) json(response, 500, { error: 'fixture_failure' });
    });
  }
);

server.listen(port, '0.0.0.0', () => console.log(`fake ${role} provider listening on https://${host}:${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
