// V1 role journeys, executed from inside the isolated release-test network (C43).
//
// This runs where the fake identity provider and the local email sink actually live. The host
// cannot reach them — the application network has no default route and no published port — so a
// journey that has to read a verification email or complete an OAuth code exchange has to run here.
//
// It only ever speaks to the TLS edge with the rehearsal's private CA. No live provider, no
// credential, no public domain is involved, and nothing it proves may be read as a live claim.
//
//   node journeys.mjs <stage>
//
// Stages are independent: each one re-authenticates from the deterministic fixture accounts and
// receives any identifiers it needs through GONES_JOURNEY_STATE, so the host can assert database
// state in between without holding a session open.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const edge = process.env.GONES_EDGE ?? 'https://tls-proxy:8443';
const publicEdgeOrigin = process.env.GONES_PUBLIC_EDGE_ORIGIN ?? 'https://localhost:8443';
const eventImageFixture = readFileSync(new URL('./event-proposal-private.webp', import.meta.url));
const sink = process.env.GONES_SINK ?? 'https://fake-brevo:8443';
const bootstrapEmail = process.env.GONES_BOOTSTRAP_ADMIN_EMAIL ?? 'bootstrap-admin@release-test.invalid';
const password = 'Release-test-pass-123!';
const organizerEmail = 'organizer@release-test.invalid';
const participantEmail = 'participant@release-test.invalid';
const standInEmail = 'stand-in@release-test.invalid';
const state = JSON.parse(process.env.GONES_JOURNEY_STATE || '{}');
const stage = process.argv[2];

const failures = [];
const check = (condition, message) => {
  if (condition) {
    console.log(`  ok   ${message}`);
    return true;
  }
  failures.push(message);
  console.error(`  FAIL ${message}`);
  return false;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Minimal HTTP client: bearer sessions, manual cookie jar, never follows a redirect. */
async function call(path, { method = 'GET', body, token, headers = {}, cookie, base = edge } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, headers: response.headers, text, json };
}

async function callBytes(path, { token } = {}) {
  const response = await fetch(`${edge}${path}`, {
    redirect: 'manual',
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer())
  };
}

async function uploadEventImage(token, fileName) {
  const form = new FormData();
  form.append('file', new Blob([eventImageFixture], { type: 'image/webp' }), fileName);
  const response = await fetch(`${edge}/api/event-images`, {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, headers: response.headers, text, json };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function uploadFixtureAndReadPrivateVariants(token, fileName) {
  const upload = await uploadEventImage(token, fileName);
  check(upload.status === 201
      && upload.json?.state === 'Temporary'
      && Array.isArray(upload.json?.variants)
      && upload.json.variants.length > 0,
    `a real WebP fixture uploads through the API into private image storage (${upload.status} ${upload.text.slice(0, 120)})`);
  if (upload.status !== 201 || !upload.json?.id || !upload.json?.variants?.length) {
    throw new Error(`event image upload failed: ${upload.status} ${upload.text.slice(0, 200)}`);
  }

  const variantHashes = new Map();
  for (const variant of upload.json.variants) {
    const privateRead = await callBytes(variant.url, { token });
    check(privateRead.status === 200
        && privateRead.headers.get('content-type')?.startsWith('image/webp')
        && privateRead.headers.get('cache-control') === 'no-store'
        && privateRead.bytes.length > 0,
      `the uploader reads its private ${variant.width}px variant bytes with no-store (${privateRead.status}, ${privateRead.bytes.length} bytes)`);
    variantHashes.set(variant.width, sha256(privateRead.bytes));
  }
  return { ...upload.json, variantHashes };
}

async function verifyPublicGallery(images, expected) {
  check(images.map((image) => image.id).join('|') === expected.map((item) => item.upload.id).join('|'),
    'the public gallery preserves exact image order');
  check(images.map((image) => image.altText).join('|') === expected.map((item) => item.altText).join('|'),
    'the public gallery preserves exact alt text');

  for (let index = 0; index < expected.length; index++) {
    const image = images[index];
    const item = expected[index];
    if (!image || image.id !== item.upload.id) continue;
    for (const variant of image.variants) {
      const first = await callBytes(variant.url);
      const repeated = await callBytes(variant.url);
      const etag = first.headers.get('etag') ?? '';
      check(first.status === 200
          && first.headers.get('content-type')?.startsWith('image/webp')
          && first.headers.get('cache-control') === 'public, max-age=31536000, immutable'
          && /^"[^"]+"$/.test(etag)
          && first.bytes.length > 0,
        `the public ${variant.width}px Event image serves immutable WebP bytes with ETag (${first.status}, ${first.bytes.length} bytes, ${etag || 'missing'})`);
      check(repeated.status === 200
          && repeated.headers.get('etag') === etag
          && sha256(repeated.bytes) === sha256(first.bytes),
        `the public ${variant.width}px Event image ETag and bytes are deterministic`);
      check(sha256(first.bytes) === item.upload.variantHashes.get(variant.width),
        `the public ${variant.width}px bytes equal the uploaded private variant`);
    }
  }
}

const idempotent = () => ({ 'Idempotency-Key': randomUUID() });

/** Reads the local email sink the way an operator would read the inbox it stands in for. */
async function sinkMessages() {
  const response = await call('/_fixture/received', { base: sink });
  return response.json?.received ?? [];
}

async function waitForActionToken(email, pathFragment, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const messages = await sinkMessages();
    const match = messages
      .filter((message) => message.to === email)
      .reverse()
      .map((message) => new RegExp(`https://[^"'<>\\s]*${pathFragment}\\?token=([A-Za-z0-9_\\-%]+)`).exec(message.htmlContent ?? ''))
      .find(Boolean);
    if (match) return decodeURIComponent(match[1]);
    await sleep(1000);
  }
  return null;
}

async function waitForReviewToken(email, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const messages = await sinkMessages();
    const match = messages
      .filter((message) => message.to === email)
      .reverse()
      .map((message) => /https:\/\/[^"'<>\s]*\/event-requests\/([A-Za-z0-9_%-]+)/.exec(message.htmlContent ?? ''))
      .find(Boolean);
    if (match) return decodeURIComponent(match[1]);
    await sleep(1000);
  }
  return null;
}

async function setProviderFaults(faults) {
  return call('/_fixture/mode', { base: sink, method: 'POST', body: faults });
}

async function registerAndVerify(email, username) {
  const registered = await call('/api/auth/register', {
    method: 'POST',
    body: { email, username, password, firstName: 'Release', lastName: 'Tester' }
  });
  if (registered.status !== 202) {
    throw new Error(`register ${email} failed: ${registered.status} ${registered.text.slice(0, 200)}`);
  }
  // Registration answers the same 202 for a fresh address and an existing one, so the sink decides:
  // a token means this run created (or re-verified) the account, no token means an already-verified re-run.
  const token = await waitForActionToken(email, '/verify-email');
  if (token) {
    const verified = await call('/api/auth/verify-email', { method: 'POST', body: { token } });
    if (verified.status >= 300) throw new Error(`verify ${email} failed: ${verified.status} ${verified.text.slice(0, 200)}`);
  }
  return login(email);
}

async function login(email) {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password, deviceLabel: 'release-rehearsal' } });
  if (response.status !== 200) throw new Error(`login ${email} failed: ${response.status} ${response.text.slice(0, 200)}`);
  const me = await call('/api/users/me', { token: response.json.accessToken });
  if (me.status !== 200) throw new Error(`profile for ${email} failed: ${me.status}`);
  return { token: response.json.accessToken, profile: me.json };
}

async function eventPayload(
  token,
  organizationId,
  formatIds,
  startsAtLocal,
  title,
  placeId = 'fixture|1%20Rue%20de%20la%20Republique|69002|Lyon|France|Auvergne-Rh%C3%B4ne-Alpes'
) {
  const resolved = await call('/api/event-locations/resolve', {
    method: 'POST',
    token,
    body: {
      placeId,
      sessionToken: randomUUID(),
      language: 'en'
    }
  });
  check(resolved.status === 200 && typeof resolved.json?.locationToken === 'string',
    `the client resolves the Event location through the deterministic provider (${resolved.status} ${resolved.text.slice(0, 120)})`);
  if (resolved.status !== 200 || !resolved.json?.locationToken) {
    throw new Error(`Event location resolution failed: ${resolved.status} ${resolved.text.slice(0, 200)}`);
  }
  return {
    organizationId,
    title,
    summary: 'Release rehearsal tournament',
    bodyMarkdown: 'Local rehearsal only.',
    location: {
      streetAddress: resolved.json.streetAddress,
      postalCode: resolved.json.postalCode,
      city: resolved.json.city,
      country: resolved.json.country,
      region: resolved.json.region,
      locationToken: resolved.json.locationToken
    },
    eventType: 'major',
    startsAtLocal: startsAtLocal.slice(0, 16),
    capacity: 8,
    formatIds,
    images: []
  };
}

/** A local date far enough out that every reminder class (monthly, Saturday, J-2, J-1) is planned. */
function futureLocal(daysAhead) {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T09:00:00`;
}

async function visitorStage() {
  const list = await call('/api/events');
  check(list.status === 200, `anonymous Visitor reads the public calendar (${list.status})`);
  const me = await call('/api/users/me');
  check(me.status === 401, `anonymous Visitor cannot read a profile (${me.status})`);
  const admin = await call('/api/admin/users');
  check(admin.status === 401, `anonymous Visitor cannot reach the Admin surface (${admin.status})`);
  const organizer = await call('/api/organizer/events');
  check(organizer.status === 401, `anonymous Visitor cannot reach the Organizer surface (${organizer.status})`);
  const spa = await call('/');
  check(spa.status === 200 && spa.text.includes('<gones-root'), 'the server-mode SPA is served from the same TLS origin as the API');
  check((spa.headers.get('content-security-policy') ?? '').includes("connect-src 'self' https://localhost:8443"),
    'the SPA content-security-policy names exactly the API origin it is allowed to call');
}

async function bootstrapStage() {
  const session = await registerAndVerify(bootstrapEmail, 'release-bootstrap');
  check(session.profile.emailVerified === true || session.profile.isEmailVerified === true || session.profile.email === bootstrapEmail,
    'the configured bootstrap account is registered and verified through the local email sink');
  const duplicate = await call('/api/auth/register', {
    method: 'POST',
    body: { email: bootstrapEmail, username: 'release-bootstrap-2', password, firstName: 'Release', lastName: 'Tester' }
  });
  check(duplicate.status === 202, `re-registering the same address is answered generically (${duplicate.status})`);
  const stillUser = await call('/api/admin/users', { token: session.token });
  check(stillUser.status === 403, `a verified account is not an Admin before the bootstrap CLI runs (${stillUser.status})`);
  emit({ bootstrapUserId: session.profile.userId ?? session.profile.id });
}

async function rolesStage() {
  const admin = await login(bootstrapEmail);
  const adminUsers = await call('/api/admin/users', { token: admin.token });
  check(adminUsers.status === 200, `the bootstrapped account reaches the Admin surface (${adminUsers.status})`);

  const organizer = await registerAndVerify(organizerEmail, 'release-organizer');
  const participant = await registerAndVerify(participantEmail, 'release-participant');
  const standIn = await registerAndVerify(standInEmail, 'release-stand-in');
  const organizerId = organizer.profile.userId ?? organizer.profile.id;
  const participantId = participant.profile.userId ?? participant.profile.id;
  const standInId = standIn.profile.userId ?? standIn.profile.id;

  const organization = await call('/api/admin/organizations/', {
    method: 'POST',
    token: admin.token,
    body: { name: `Release Rehearsal Club ${randomUUID().slice(0, 8)}` }
  });
  check(organization.status === 201, `an Admin creates the organization (${organization.status})`);
  const organizationId = organization.json.id;

  // Adding membership is the only source of the global Organizer role (ADR 0041). It revokes the
  // account's refresh sessions on purpose, so each new member signs in again afterwards.
  const addedOrganizer = await call(`/api/organizations/${organizationId}/members`, {
    method: 'POST',
    token: admin.token,
    body: { userId: organizerId, role: 'Organizer' }
  });
  check(addedOrganizer.status === 201, `the Admin adds the Organizer member (${addedOrganizer.status})`);
  Object.assign(organizer, await login(organizerEmail));

  const members = await call(`/api/organizations/${organizationId}/members`, { token: organizer.token });
  check(members.status === 200 && members.json.some((member) => member.role === 'Organizer' && member.userId === organizerId),
    'the organization member the Admin nominated is an Organizer');

  const addedMember = await call(`/api/organizations/${organizationId}/members`, {
    method: 'POST',
    token: admin.token,
    body: { userId: standInId, role: 'Organizer' }
  });
  check(addedMember.status === 201, `the Admin adds a second Organizer member (${addedMember.status})`);
  Object.assign(standIn, await login(standInEmail));

  const retiredTransfer = await call(`/api/organizations/${organizationId}/transfer-ownership`, {
    method: 'POST',
    token: standIn.token,
    body: { newOwnerUserId: standInId }
  });
  check(retiredTransfer.status === 404, `the retired ownership-transfer endpoint stays absent (${retiredTransfer.status})`);

  const formats = await call('/api/formats');
  check(formats.status === 200 && formats.json.length > 0, 'the public format catalog is populated');
  const formatIds = [formats.json[0].id];

  const startsAtLocal = futureLocal(70);
  const payload = await eventPayload(organizer.token, organizationId, formatIds, startsAtLocal, 'Release Rehearsal Cup');
  const published = await call('/api/events', {
    method: 'POST',
    token: organizer.token,
    headers: idempotent(),
    body: payload
  });
  const publishedLocation = published.headers.get('location') ?? '';
  let publishedLocationUrl;
  try { publishedLocationUrl = new URL(publishedLocation, publicEdgeOrigin); } catch { publishedLocationUrl = null; }
  const publishedETag = published.headers.get('etag') ?? '';
  check(published.status === 201
      && published.json.status === 'Published'
      && publishedLocationUrl?.origin === publicEdgeOrigin
      && publishedLocationUrl.pathname === `/api/events/${published.json.slug}`
      && /^"[^"]+"$/.test(publishedETag),
    `the Organizer directly publishes the Event with Location and ETag; expected edge origin and path verified (${published.status} location=${publishedLocation || 'missing'} etag=${publishedETag || 'missing'} ${published.text.slice(0, 120)})`);
  const tournamentId = published.json.id;
  const slug = published.json.slug;

  const publicDetail = await call(`/api/events/${slug}`);
  check(publicDetail.status === 200, `a Visitor reads the published tournament (${publicDetail.status})`);
  check(publicDetail.json?.bodyHtml === '<p>Local rehearsal only.</p>',
    'the public detail derives safe HTML from the authored Markdown');
  const ics = await call(`/api/events/${slug}.ics`);
  check(ics.status === 200 && ics.text.includes('BEGIN:VEVENT') && ics.text.includes('Europe/Paris'),
    'the tournament exports an ICS entry carrying the venue time zone');

  const registrationKey = randomUUID();
  const registered = await call(`/api/events/${tournamentId}/registrations`, {
    method: 'POST', token: participant.token, headers: { 'Idempotency-Key': registrationKey }
  });
  check(registered.status === 201, `a verified User registers (${registered.status} ${registered.text.slice(0, 160)})`);
  const replayed = await call(`/api/events/${tournamentId}/registrations`, {
    method: 'POST', token: participant.token, headers: { 'Idempotency-Key': registrationKey }
  });
  check(replayed.status === 201 || replayed.status === 200, `replaying the same Idempotency-Key is not a second registration (${replayed.status})`);
  const duplicate = await call(`/api/events/${tournamentId}/registrations`, {
    method: 'POST', token: participant.token, headers: idempotent()
  });
  check(duplicate.status === 409, `a second active registration is refused (${duplicate.status})`);

  const anonymousParticipants = await call(`/api/events/${slug}/participants`);
  check(anonymousParticipants.status === 200 && !anonymousParticipants.text.includes(participantEmail),
    'the public participant view never exposes a participant address');
  const privateParticipants = await call(`/api/events/${tournamentId}/registrations`, { token: organizer.token });
  check(privateParticipants.status === 200 && privateParticipants.text.includes(participantEmail),
    'the Organizer private participant view resolves the participant');

  const csv = await call(`/api/events/${tournamentId}/registrations/export`, { token: organizer.token });
  check(csv.status === 200 && csv.text.includes(participantEmail), `the Organizer exports participants as CSV (${csv.status})`);
  check(!/^[=+\-@]/m.test(csv.text), 'the CSV export never starts a cell with a spreadsheet formula character');

  const manual = await call(`/api/events/${tournamentId}/registrations/by-organizer`, {
    method: 'POST', token: organizer.token, headers: idempotent(), body: { userId: standInId }
  });
  check(manual.status === 201, `the Organizer registers a participant manually (${manual.status})`);
  const manualId = manual.json.attemptId;
  const removed = await call(`/api/events/${tournamentId}/registrations/${manualId}`, {
    method: 'DELETE', token: organizer.token, headers: idempotent()
  });
  check(removed.status === 200 || removed.status === 204, `the Organizer removes that participant (${removed.status})`);

  const blocked = await call(`/api/organizations/${organizationId}/blocked-users`, {
    method: 'POST', token: organizer.token, body: { userId: standInId, reason: 'release rehearsal block' }
  });
  check(blocked.status === 201, `the Organizer blocks a user for the organization (${blocked.status})`);
  const blockedAttempt = await call(`/api/events/${tournamentId}/registrations`, {
    method: 'POST', token: standIn.token, headers: idempotent()
  });
  check(blockedAttempt.status === 403, `a blocked user cannot register (${blockedAttempt.status})`);

  // Fake OAuth: the whole authorization-code exchange happens inside this network.
  const start = await call('/api/auth/oauth/google/start');
  const authorizeUrl = start.headers.get('location') ?? '';
  check(start.status === 302 && authorizeUrl.startsWith('https://fake-identity:8443/authorize'),
    `OAuth start redirects to the local fake identity provider (${authorizeUrl.slice(0, 48)})`);
  check(!/google\.com|facebook\.com|googleapis\.com/.test(authorizeUrl), 'no live identity provider is contacted');
  const correlation = (start.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');
  const authorized = await fetch(authorizeUrl, { redirect: 'manual' });
  const callbackUrl = new URL(authorized.headers.get('location') ?? '');
  const callback = await call(
    `/api/auth/oauth/google/callback?code=${encodeURIComponent(callbackUrl.searchParams.get('code') ?? '')}&state=${encodeURIComponent(callbackUrl.searchParams.get('state') ?? '')}`,
    { cookie: correlation });
  check(callback.status === 200, `the OAuth callback completes against the fake provider (${callback.status})`);
  const oauthSession = callback.json?.accessToken
    ? callback.json
    : (await call('/api/auth/oauth/complete', {
      method: 'POST',
      body: {
        completionTicket: callback.json?.completionTicket,
        email: callback.json?.email,
        username: 'release-oauth',
        firstName: 'Release',
        lastName: 'Oauth'
      }
    })).json;
  check(typeof oauthSession?.accessToken === 'string', 'the fake-OAuth account reaches an authenticated session');
  const oauthProfile = await call('/api/users/me', { token: oauthSession.accessToken });
  check(oauthProfile.status === 200, `the fake-OAuth User reads its own profile (${oauthProfile.status})`);
  const oauthAdmin = await call('/api/admin/users', { token: oauthSession.accessToken });
  check(oauthAdmin.status === 403, `the fake-OAuth User is not an Admin (${oauthAdmin.status})`);

  emit({ organizationId, tournamentId, slug, organizerId, participantId, standInId, formatIds });
}

async function eventLifecycleStage() {
  const organizer = await login(organizerEmail);
  const plainUser = await login(participantEmail);
  check(plainUser.profile.globalRole === 'User', 'the proposal submitter is a plain verified User');
  const formatIds = state.formatIds;
  if (!state.organizationId || !state.organizerId || !Array.isArray(formatIds) || formatIds.length !== 1) {
    throw new Error('event lifecycle state is missing organization, Organizer, or format identifiers');
  }

  const first = await uploadFixtureAndReadPrivateVariants(organizer.token, 'direct-first.webp');
  const second = await uploadFixtureAndReadPrivateVariants(organizer.token, 'direct-second.webp');
  const startsAtLocal = futureLocal(80);
  const directPayload = await eventPayload(
    organizer.token,
    state.organizationId,
    formatIds,
    startsAtLocal,
    `Integrated Event ${randomUUID().slice(0, 8)}`);
  directPayload.summary = 'Integrated real-storage journey';
  directPayload.bodyMarkdown = 'Created with **Markdown** and real image bytes.';
  directPayload.images = [
    { imageId: second.id, altText: 'Second upload leads' },
    { imageId: first.id, altText: 'First upload follows' }
  ];

  const published = await call('/api/events', {
    method: 'POST',
    token: organizer.token,
    headers: idempotent(),
    body: directPayload
  });
  const location = published.headers.get('location') ?? '';
  let locationUrl;
  try { locationUrl = new URL(location, publicEdgeOrigin); } catch { locationUrl = null; }
  check(published.status === 201
      && locationUrl?.origin === publicEdgeOrigin
      && locationUrl.pathname === `/api/events/${published.json?.slug}`,
    `direct Event publication returns expected edge Location origin and path (${published.status} ${location || 'missing'})`);
  if (published.status !== 201 || !published.json?.id || !published.json?.slug) {
    throw new Error(`direct Event publication failed: ${published.status} ${published.text.slice(0, 200)}`);
  }

  const createdDetail = await call(`/api/events/${published.json.slug}`);
  check(createdDetail.status === 200
      && createdDetail.json?.bodyHtml === '<p>Created with <strong>Markdown</strong> and real image bytes.</p>'
      && createdDetail.json?.venue?.streetAddress === directPayload.location.streetAddress,
    'direct Event public detail preserves Markdown and resolved location');
  await verifyPublicGallery(createdDetail.json.images, [
    { upload: second, altText: 'Second upload leads' },
    { upload: first, altText: 'First upload follows' }
  ]);

  const added = await uploadFixtureAndReadPrivateVariants(organizer.token, 'edit-added.webp');
  const management = await call('/api/organizer/events?pageSize=100', { token: organizer.token });
  const managed = management.json?.items?.find((item) => item.id === published.json.id);
  check(management.status === 200 && typeof managed?.eTag === 'string',
    'the real Organizer management read supplies If-Match state for the created Event');
  if (!managed?.eTag) throw new Error(`created Event missing from management response: ${management.status}`);

  const changedLocationPayload = await eventPayload(
    organizer.token,
    state.organizationId,
    formatIds,
    startsAtLocal,
    directPayload.title,
    'fixture|9%20Rue%20Victor%20Hugo|69003|Lyon|France|Auvergne-Rh%C3%B4ne-Alpes');
  const edited = await call(`/api/organizer/events/${published.json.id}/details`, {
    method: 'PATCH',
    token: organizer.token,
    headers: { 'if-match': managed.eTag },
    body: {
      title: `${directPayload.title} Edited`,
      summary: 'Edited integrated journey',
      bodyMarkdown: 'Edited with **Markdown**, reordered and replaced media.',
      location: changedLocationPayload.location,
      eventType: directPayload.eventType,
      startsAtLocal: directPayload.startsAtLocal,
      capacity: directPayload.capacity,
      formatIds,
      images: [
        { imageId: first.id, altText: 'Retained image reordered first' },
        { imageId: added.id, altText: 'New image added second' }
      ]
    }
  });
  check(edited.status === 200
      && /^"[^"]+"$/.test(edited.headers.get('etag') ?? '')
      && edited.json?.location?.streetAddress === changedLocationPayload.location.streetAddress,
    `If-Match edit commits resolved location, Markdown, media add/remove/reorder (${edited.status})`);

  const editedDetail = await call(`/api/events/${published.json.slug}`);
  check(editedDetail.status === 200
      && editedDetail.json?.bodyHtml === '<p>Edited with <strong>Markdown</strong>, reordered and replaced media.</p>'
      && editedDetail.json?.venue?.streetAddress === changedLocationPayload.location.streetAddress,
    'edited public detail preserves new Markdown and resolved location');
  await verifyPublicGallery(editedDetail.json.images, [
    { upload: first, altText: 'Retained image reordered first' },
    { upload: added, altText: 'New image added second' }
  ]);
  const removed = await callBytes(`/api/event-images/${second.id}/variants/${second.variants[0].width}`);
  check(removed.status === 404, `removed Event image stops resolving after committed edit (${removed.status})`);

  const proposalUpload = await uploadFixtureAndReadPrivateVariants(plainUser.token, 'proposal.webp');
  const proposalPayload = await eventPayload(
    plainUser.token,
    state.organizationId,
    formatIds,
    futureLocal(90),
    `Integrated Proposal ${randomUUID().slice(0, 8)}`);
  proposalPayload.summary = 'Plain User proposal';
  proposalPayload.bodyMarkdown = 'Proposal with **private** media.';
  proposalPayload.images = [{ imageId: proposalUpload.id, altText: 'Proposal gallery image' }];
  const approvers = await call(`/api/event-proposals/approvers?organizationId=${state.organizationId}`, { token: plainUser.token });
  check(approvers.status === 200 && approvers.json?.some((item) => item.id === state.organizerId),
    'the plain User can select the organization Organizer as proposal reviewer');

  const proposal = await call('/api/event-proposals', {
    method: 'POST',
    token: plainUser.token,
    body: { event: proposalPayload, recipientUserIds: [state.organizerId] }
  });
  check(proposal.status === 201 && proposal.json?.status === 'Pending',
    `the plain User submits proposal with uploaded media (${proposal.status})`);
  if (proposal.status !== 201) throw new Error(`proposal submission failed: ${proposal.status} ${proposal.text.slice(0, 200)}`);

  const reviewToken = await waitForReviewToken(organizerEmail);
  check(typeof reviewToken === 'string' && reviewToken.length > 20,
    'the proposal review token reaches the local mail sink');
  if (!reviewToken) throw new Error('proposal review token did not reach local mail sink');
  const review = await call(`/api/event-proposals/by-token/${encodeURIComponent(reviewToken)}`);
  check(review.status === 200
      && review.json?.images?.length === 1
      && review.json.images[0].id === proposalUpload.id
      && review.json.images[0].altText === 'Proposal gallery image',
    'token review preserves private proposal image order and alt text');
  const reviewVariant = review.json?.images?.[0]?.variants?.[0];
  if (!reviewVariant) throw new Error(`proposal review image missing: ${review.status} ${review.text.slice(0, 200)}`);
  const privateReview = await callBytes(reviewVariant.url);
  check(privateReview.status === 200
      && privateReview.headers.get('cache-control') === 'no-store'
      && sha256(privateReview.bytes) === proposalUpload.variantHashes.get(reviewVariant.width),
    'token-scoped proposal review serves original private bytes with no-store');

  const approval = await call(`/api/event-proposals/by-token/${encodeURIComponent(reviewToken)}/approve`, { method: 'POST' });
  check(approval.status === 200 && approval.json?.status === 'Approved' && typeof approval.json?.slug === 'string',
    `token review approves the proposal into a public Event (${approval.status})`);
  if (!approval.json?.slug) throw new Error(`proposal approval failed: ${approval.status} ${approval.text.slice(0, 200)}`);
  const proposalDetail = await call(`/api/events/${approval.json.slug}`);
  check(proposalDetail.status === 200
      && proposalDetail.json?.bodyHtml === '<p>Proposal with <strong>private</strong> media.</p>',
    'approved proposal Markdown becomes public detail');
  await verifyPublicGallery(proposalDetail.json.images, [
    { upload: proposalUpload, altText: 'Proposal gallery image' }
  ]);

  check(failures.length === 0, 'the clean-volume Event lifecycle traverses real API, Postgres and MinIO');
  emit({ integratedEventId: published.json.id, proposalEventSlug: approval.json.slug });
}

async function deleteRestoreStage() {
  const admin = await login(bootstrapEmail);
  const organizer = await login(organizerEmail);
  const payload = await eventPayload(
    organizer.token,
    state.organizationId,
    state.formatIds ?? (await call('/api/formats')).json.map((format) => format.id).slice(0, 1),
    futureLocal(50),
    'Release Rehearsal Spare');
  const published = await call('/api/events', {
    method: 'POST', token: organizer.token, headers: idempotent(), body: payload
  });
  check(published.status === 201, `a spare tournament is published for the delete/restore journey (${published.status} ${published.text.slice(0, 160)})`);
  const id = published.json.id;
  const slug = published.json.slug;

  const managed = await call('/api/organizer/events', { token: organizer.token });
  const entry = managed.json.items.find((item) => item.id === id);
  check(Boolean(entry?.eTag), 'the Organizer management list carries the concurrency token');

  const stale = await call(`/api/events/${id}`, {
    method: 'DELETE', token: organizer.token, headers: { 'if-match': '"0"', ...idempotent() }, body: { reason: 'stale write' }
  });
  check(stale.status === 412 || stale.status === 409, `a stale If-Match is refused (${stale.status})`);

  const deleted = await call(`/api/events/${id}`, {
    method: 'DELETE', token: organizer.token, headers: { 'if-match': entry.eTag, ...idempotent() }, body: { reason: 'release rehearsal' }
  });
  check(deleted.status === 200 || deleted.status === 204, `the Organizer soft-deletes the tournament (${deleted.status})`);
  const gone = await call(`/api/events/${slug}`);
  check(gone.status === 404, `a deleted tournament disappears from the public surface (${gone.status})`);

  const deletedList = await call('/api/admin/events/deleted', { token: admin.token });
  const deletedEntry = deletedList.json.items.find((item) => item.id === id);
  check(Boolean(deletedEntry), 'the Admin sees the deleted tournament');
  const restored = await call(`/api/admin/events/${id}/restore`, {
    method: 'POST', token: admin.token, headers: { 'if-match': deletedEntry.eTag }
  });
  check(restored.status === 200 || restored.status === 204, `the Admin restores the tournament (${restored.status})`);
  const back = await call(`/api/events/${slug}`);
  check(back.status === 200, `the restored tournament is public again (${back.status})`);
  emit({ spareTournamentId: id, spareSlug: slug });
}

async function spareRegisterStage() {
  const participant = await login(participantEmail);
  const response = await call(`/api/events/${state.spareTournamentId}/registrations`, {
    method: 'POST', token: participant.token, headers: idempotent()
  });
  check(response.status === 201, `the participant registers on the second tournament (${response.status})`);
}

async function dateChangeStage() {
  const organizer = await login(organizerEmail);
  const managed = await call('/api/organizer/events', { token: organizer.token });
  const entry = managed.json.items.find((item) => item.id === state.tournamentId);
  check(Boolean(entry), 'the Organizer can still manage the rehearsal tournament');
  const startsAtLocal = futureLocal(40);
  const update = await call(`/api/organizer/events/${state.tournamentId}/details`, {
    method: 'PATCH',
    token: organizer.token,
    headers: { 'if-match': entry.eTag },
    body: {
      title: entry.title,
      summary: entry.summary,
      bodyMarkdown: entry.bodyMarkdown,
      location: {
        streetAddress: entry.location.streetAddress,
        postalCode: entry.location.postalCode,
        city: entry.location.city,
        country: entry.location.country,
        region: entry.location.region,
        locationToken: entry.location.locationToken
      },
      eventType: entry.eventType,
      startsAtLocal: startsAtLocal.slice(0, 16),
      capacity: entry.capacity,
      formatIds: entry.formatIds,
      images: entry.images.map((image) => ({ imageId: image.id, altText: image.altText }))
    }
  });
  check(update.status === 200, `the Organizer moves the tournament date (${update.status})`);
  emit({ startsAtLocal });
}

async function unregisterStage() {
  const participant = await login(participantEmail);
  const response = await call(`/api/events/${state.spareTournamentId}/registrations`, {
    method: 'DELETE', token: participant.token, headers: idempotent()
  });
  check(response.status === 200 || response.status === 204, `the participant unregisters (${response.status})`);
  const mine = await call('/api/users/me/registrations', { token: participant.token });
  check(!mine.json.items.some((item) => item.eventId === state.spareTournamentId && item.status === 'Confirmed'),
    'the cancelled registration is no longer confirmed for that user');
}

async function cancelStage() {
  const organizer = await login(organizerEmail);
  const managed = await call('/api/organizer/events', { token: organizer.token });
  const entry = managed.json.items.find((item) => item.id === state.tournamentId);
  const response = await call(`/api/events/${state.tournamentId}/cancel`, {
    method: 'POST', token: organizer.token, headers: { 'if-match': entry.eTag, ...idempotent() }
  });
  check(response.status === 200, `the Organizer cancels the tournament (${response.status})`);
}

async function deadLetterStage() {
  const admin = await login(bootstrapEmail);
  const before = await call('/api/admin/notifications/dead-letters', { token: admin.token });
  check(before.status === 200, `the Admin can list dead letters (${before.status})`);
  // The provider fails every attempt from here; the retry ladder is real, but the host drives the
  // clock by making each retry immediately available so the rehearsal never waits out the backoff.
  const faults = await setProviderFaults({ failSends: Number(state.failSends ?? 24), statusCode: 503 });
  check(faults.status === 200, 'the local provider fake is switched into failure mode');
  // forgot-password always enqueues for an existing account, verified or not, so the failure path
  // is exercised on a real transactional message rather than a synthetic one.
  const resend = await call('/api/auth/forgot-password', { method: 'POST', body: { email: standInEmail } });
  check(resend.status === 202 || resend.status === 200, `a fresh transactional message is enqueued (${resend.status})`);
  emit({ deadLetterCountBefore: before.json.items?.length ?? 0 });
}

async function reconciliationStage() {
  // An accepted-looking response with no message id is the "we cannot tell" case: the outbox must
  // hold it for an operator instead of guessing, because a blind resend can double-send a real email.
  const faults = await setProviderFaults({ failSends: 0, invalidResponses: 1 });
  check(faults.status === 200, 'the local provider fake is switched to an acceptance-uncertain response');
  const resend = await call('/api/auth/forgot-password', { method: 'POST', body: { email: participantEmail } });
  check(resend.status === 202 || resend.status === 200, `another transactional message is enqueued (${resend.status})`);
}

async function deadLetterRetryStage() {
  const admin = await login(bootstrapEmail);
  await setProviderFaults({ failSends: 0, invalidResponses: 0 });
  const list = await call('/api/admin/notifications/dead-letters', { token: admin.token });
  check(list.json.items.some((item) => item.id === state.deadLetterId), 'the permanently failed message is in the dead-letter queue');
  const target = list.json.items.find((item) => item.id === state.reconciliationId);
  check(Boolean(target), 'the acceptance-uncertain message is held for operator reconciliation');

  const unapproved = await call(`/api/admin/notifications/dead-letters/${target.id}/retry`, {
    method: 'POST', token: admin.token, body: { operatorApproved: false }
  });
  check(unapproved.status === 400, `a replay without explicit operator approval is refused (${unapproved.status})`);

  const retried = await call(`/api/admin/notifications/dead-letters/${target.id}/retry`, {
    method: 'POST', token: admin.token, body: { operatorApproved: true }
  });
  check(retried.status === 201, `the Admin replays the held message after approving it (${retried.status})`);
  const history = await call('/api/admin/notifications/history', { token: admin.token });
  check(history.status === 200, `the Admin reads the notification history (${history.status})`);
}

function emit(value) {
  console.log(`JOURNEY_STATE ${JSON.stringify(value)}`);
}

const stages = {
  visitor: visitorStage,
  bootstrap: bootstrapStage,
  roles: rolesStage,
  'event-lifecycle': eventLifecycleStage,
  'delete-restore': deleteRestoreStage,
  'spare-register': spareRegisterStage,
  'date-change': dateChangeStage,
  unregister: unregisterStage,
  cancel: cancelStage,
  'dead-letter': deadLetterStage,
  reconciliation: reconciliationStage,
  'dead-letter-retry': deadLetterRetryStage
};

const runner = stages[stage];
if (!runner) {
  console.error(`Unknown journey stage "${stage}". Known stages: ${Object.keys(stages).join(', ')}`);
  process.exit(2);
}

try {
  await runner();
} catch (error) {
  console.error(`  FAIL ${stage} threw: ${error instanceof Error ? error.message : String(error)}`);
  failures.push(String(error));
}

if (failures.length > 0) {
  console.error(`journey stage ${stage} failed with ${failures.length} finding(s)`);
  process.exit(1);
}
console.log(`journey stage ${stage} passed`);
