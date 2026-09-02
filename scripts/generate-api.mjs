import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const backend = join(root, 'backend');
const snapshot = join(backend, 'openapi', 'gones.json');
const generated = join(root, 'src', 'app', 'api', 'generated', 'gones-api.ts');
const check = process.argv.includes('--check');
const normalizeGenerated = value => value
  .replaceAll('\r\n', '\n')
  .replace(/[ \t]+$/gm, '')
  .replace(
    /(?:export interface FileParameter \{ data: Blob; fileName\?: string; \}\n\n)?export const API_BASE_URL = new InjectionToken<string>\('API_BASE_URL'\);/,
    "export interface FileParameter { data: Blob; fileName?: string; }\n\nexport const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');")
  // NSwag 14 emits nullable enum `oneOf` refs as empty interfaces. Keep generated DTOs typed to
  // OpenAPI's canonical Event Type enum instead of forcing every consumer through unsafe casts.
  .replace(/export interface (EventType\d*) \{\n\n    \[key: string\]: any;\n\}/g, 'export type $1 = `${PublicCalendarEventType}`;')
  .replace(/export enum (EventPayloadRequestEventType|UpdateEventDetailsRequestEventType) \{\n    Weekly = "weekly",\n    Monthly = "monthly",\n    Major = "major",\n\}/g, 'export type $1 = "weekly" | "monthly" | "major";')
  .replace(/eventImagesPOST\(file: FileParameter \| undefined\)/g, 'eventImagesPOST(file: FileParameter)')
  .replace('export interface EventImageUploadForm {\n    file: string;', 'export interface EventImageUploadForm {\n    file: Blob;')
  .replace('    state: EventImageUploadResponseState;', '    state: "Temporary";')
  .replace(/\nexport enum EventImageUploadResponseState \{\n    Temporary = "Temporary",\n\}\n/g, '\n');
const listenUrl = 'http://127.0.0.1:0';
const temp = mkdtempSync(join(tmpdir(), 'gones-api-'));
const tempSnapshot = join(temp, 'gones.json');
const tempGenerated = join(temp, 'gones-api.ts');
const restore = spawnSync('dotnet', ['tool', 'restore', '--tool-manifest', join(backend, '.config', 'dotnet-tools.json')], { cwd: root, encoding: 'utf8' });
if (restore.status !== 0) throw new Error(`${restore.stdout}\n${restore.stderr}`);

const api = spawn('dotnet', ['run', '--project', join(backend, 'src', 'Gones.Api', 'Gones.Api.csproj'), '--configuration', 'Release', '--no-launch-profile', '--urls', listenUrl], {
  cwd: root,
  env: {
    ...process.env,
    ASPNETCORE_ENVIRONMENT: 'Development',
    DOTNET_ENVIRONMENT: 'Development',
    GONES_DB_CONNECTION: process.env.GONES_DB_CONNECTION ?? 'Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones',
    GONES_ALLOWED_ORIGINS: process.env.GONES_ALLOWED_ORIGINS ?? 'http://127.0.0.1:4200',
    'GONES_FEATURES__AUTH_V1': 'true',
    'GONES_FEATURES__ADMIN_V1': 'true',
    GONES_AUTH_PROVIDER: 'Local',
    GONES_AUTH_SIGNING_KEY: 'x'.repeat(32),
    GONES_PUBLIC_APP_ORIGIN: 'https://app.example'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
api.stdout.on('data', chunk => output += chunk);
api.stderr.on('data', chunk => output += chunk);

try {
  let document;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const boundUrl = output.match(/Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!boundUrl) throw new Error('API still starting.');
      const response = await fetch(`${boundUrl}/openapi/v1.json`);
      if (response.ok) {
        document = await response.json();
        break;
      }
    } catch { /* API still starting. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  if (!document) throw new Error(`API OpenAPI endpoint did not start.\n${output}`);
  document.servers = [{ url: '' }];
  // ASP.NET OpenAPI currently drops `AllowedValuesAttribute` from query-string schemas. Preserve
  // server's explicit Event Type allowlist in published contract plus generated client.
  const eventTypeValues = ['weekly', 'monthly', 'major'];
  const eventTypeParameter = document.paths?.['/api/events']?.get?.parameters
    ?.find(parameter => parameter.name === 'eventType' && parameter.in === 'query');
  if (eventTypeParameter) eventTypeParameter.schema = { type: 'string', enum: eventTypeValues };
  const eventTypeSchema = document.components?.schemas?.PublicCalendarEventType;
  if (eventTypeSchema) Object.assign(eventTypeSchema, { type: 'string', enum: eventTypeValues });
  for (const schemaName of ['EventPayloadRequest', 'UpdateEventDetailsRequest']) {
    const property = document.components?.schemas?.[schemaName]?.properties?.eventType;
    if (property) document.components.schemas[schemaName].properties.eventType = { type: 'string', enum: eventTypeValues };
  }
  // ASP.NET OpenAPI emits DateTimeOffset's format but omits its JSON type. Keep the location token
  // expiry on the documented RFC 3339 string contract instead of generating it as `any`.
  const locationExpiry = document.components?.schemas?.ResolvedEventLocationResponse?.properties?.expiresAt;
  if (locationExpiry) Object.assign(locationExpiry, { type: 'string', format: 'date-time' });
  // Runtime accepts omissions so endpoint can return per-field errors instead of framework-level
  // malformed_request. They remain required in public contract plus generated callers.
  const locationAutocompleteParameters = document.paths?.['/api/event-locations/autocomplete']?.get?.parameters ?? [];
  for (const name of ['input', 'sessionToken', 'language']) {
    const index = locationAutocompleteParameters.findIndex(candidate => candidate.name === name && candidate.in === 'query');
    if (index >= 0) {
      const parameter = { ...locationAutocompleteParameters[index] };
      delete parameter.required;
      delete parameter.schema;
      locationAutocompleteParameters[index] = { ...parameter, required: true, schema: { type: 'string' } };
    }
  }
  const eventImageResponse = document.components?.schemas?.EventImageUploadResponse;
  if (eventImageResponse?.properties?.state) eventImageResponse.properties.state = { type: 'string', enum: ['Temporary'] };
  if (eventImageResponse?.properties?.expiresAt) eventImageResponse.properties.expiresAt = { type: 'string', format: 'date-time' };
  for (const path of [
    '/api/event-images/{imageId}/variants/{width}',
    '/api/event-requests/{token}/images/{imageId}/variants/{width}'
  ]) {
    const response = document.paths?.[path]?.get?.responses?.['200'];
    if (response) response.content = { 'image/webp': { schema: { type: 'string', format: 'binary' } } };
  }
  const proposalImageResponse = document.paths?.['/api/event-requests/{token}/images/{imageId}/variants/{width}']?.get?.responses?.['200'];
  if (proposalImageResponse) {
    proposalImageResponse.headers = {
      'Cache-Control': {
        description: 'Private proposal media must never be cached.',
        schema: { type: 'string', enum: ['no-store'] }
      }
    };
  }
  writeFileSync(tempSnapshot, `${JSON.stringify(document, null, 2)}\n`);

  const generation = spawnSync('dotnet', [
    'nswag', 'openapi2tsclient', `/input:${tempSnapshot}`, `/output:${tempGenerated}`,
    '/template:Angular', '/httpClass:HttpClient', '/injectionTokenType:InjectionToken',
    '/rxJsVersion:7.0', '/generateClientClasses:true', '/generateClientInterfaces:true',
    '/generateDtoTypes:true', '/typeStyle:Interface', '/dateTimeType:string', '/useSingletonProvider:true'
  ], { cwd: backend, encoding: 'utf8' });
  if (generation.status !== 0) throw new Error(`${generation.stdout}\n${generation.stderr}`);

  const files = [[snapshot, tempSnapshot], [generated, tempGenerated]];
  if (check) {
    const changed = files.filter(([committed, candidate]) => normalizeGenerated(readFileSync(committed, 'utf8')) !== normalizeGenerated(readFileSync(candidate, 'utf8')));
    if (changed.length) throw new Error(`Generated API contract stale: ${changed.map(([path]) => path.replace(`${root}\\`, '')).join(', ')}. Run npm run api:generate.`);
  } else {
    for (const [destination, source] of files) writeFileSync(destination, normalizeGenerated(readFileSync(source, 'utf8')));
  }
} finally {
  api.kill();
  rmSync(temp, { recursive: true, force: true });
}
