#!/usr/bin/env node
// Explicit offline test only: cached pinned nginx, no network/ports/pulls/host credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const image = readFileSync(join(root, 'Dockerfile'), 'utf8').match(/^ARG NGINX_IMAGE=(\S+@sha256:[a-f0-9]{64})$/m)?.[1];
assert(image, 'pinned frontend base image required');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.error?.message || 'nonzero exit'}`);
  return result.stdout + result.stderr;
}
run('docker', ['image', 'inspect', image]);
run('openssl', ['version']);
mkdirSync(join(root, '.tmp'), { recursive: true });
const directory = mkdtempSync(join(root, '.tmp/shared-host-nginx-'));
const container = `gones-i2-nginx-${randomUUID()}`;
const sentinel = 'GONES_SYNTHETIC_TOKEN_SENTINEL';
try {
  chmodSync(directory, 0o755);
  const copy = (source, target) => writeFileSync(join(directory, target), readFileSync(join(root, source)));
  copy('deploy/shared-host/frontend-nginx.conf', 'nginx.conf');
  copy('deploy/nginx/default.conf.template', 'default.conf.template');
  copy('deploy/nginx/runtime-include.conf', 'runtime-include.conf');
  copy('deploy/nginx/gones-runtime-entrypoint.sh', 'runtime.sh');
  copy('deploy/nginx/gones-data-authority.sh', 'authority.sh');
  chmodSync(join(directory, 'authority.sh'), 0o555);
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture.invalid',
    '-keyout', join(directory, 'fixture.key'), '-out', join(directory, 'fixture.pem')]);
  // Ephemeral self-signed fixture only, readable by unprivileged nginx; never real TLS material.
  chmodSync(join(directory, 'fixture.key'), 0o444);
  for (const environment of ['staging', 'prod']) {
    const template = readFileSync(join(root, `deploy/shared-host/edge.${environment}.conf.template`), 'utf8');
    const rendered = template.replace(`\${GONES_${environment.toUpperCase()}_HOST}`, `${environment}.example.invalid`)
      .replace(`/etc/gones/edge/tls/${environment}/fullchain.pem`, '/fixture/fixture.pem')
      .replace(`/etc/gones/edge/tls/${environment}/privkey.pem`, '/fixture/fixture.key');
    writeFileSync(join(directory, `edge.${environment}.conf`), rendered);
    writeFileSync(join(directory, `${environment}.nginx.conf`), `pid /tmp/edge.pid; error_log /dev/null crit; events {} http { access_log off; include /fixture/edge.${environment}.conf; }`);
  }
  const mounts = [
    [directory, '/fixture'], [join(directory, 'nginx.conf'), '/etc/nginx/nginx.conf'],
    [join(directory, 'runtime-include.conf'), '/etc/nginx/conf.d/default.conf'],
    [join(directory, 'default.conf.template'), '/etc/nginx/gones/default.conf.template'],
    [join(directory, 'authority.sh'), '/etc/nginx/gones/gones-data-authority.sh']
  ].flatMap(([source, target]) => ['--mount', `type=bind,source=${source},target=${target},readonly`]);
  const output = run('docker', ['run', '--rm', '--name', container, '--pull=never', '--network', 'none', '--read-only', '--user', '101:101',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '0.25', '--memory', '128m', '--memory-swap', '128m', '--pids-limit', '64',
    '--log-driver', 'none', '--tmpfs', '/tmp:size=32m,mode=1777', '--tmpfs', '/var/cache/nginx:size=8m,uid=101,gid=101', ...mounts,
    '--env', 'GONES_DATA_MODE=server', '--env', 'GONES_API_BASE_URL=https://staging.example.invalid', '--env', 'GONES_AUTH_V1=true', '--env', 'GONES_ADMIN_V1=true',
    '--entrypoint', 'sh', image, '-ec', `
      sh /fixture/runtime.sh
      nginx -t
      nginx -t -c /fixture/staging.nginx.conf
      nginx -t -c /fixture/prod.nginx.conf
      nginx
      trap 'nginx -s quit' EXIT
      wget -q -O /tmp/config http://127.0.0.1:8080/runtime-config.json
      grep -q '"dataMode":"server"' /tmp/config
      for route in reset-password verify-email verify-email-change; do
        wget -q -O /tmp/page "http://127.0.0.1:8080/$route?token=${sentinel}"
      done
      wget -q -O /tmp/page "http://127.0.0.1:8080/invitation/${sentinel}"
      rm /tmp/gones-www/runtime-config.json
      if wget -q -O /tmp/page "http://127.0.0.1:8080/runtime-config.json?token=${sentinel}" 2>/tmp/client-error; then exit 1; fi
      printf 'GET /${sentinel}?token=${sentinel} HTTP/1.1\\r\\nHost: localhost\\r\\nInvalid Header\\r\\n\\r\\n' | nc -w 1 127.0.0.1 8080 >/tmp/malformed-response || true
    `]);
  assert(!output.includes(sentinel), 'synthetic bearer token leaked to nginx stdout/stderr');
  assert(output.includes('syntax is ok'), 'nginx syntax observation missing');
  console.log('shared-host nginx: frontend + both edge syntax passed; runtime config served; success/error token sentinels absent from stdout/stderr');
} finally {
  // Names/paths belong only to this mkdtemp/UUID test; never clean other containers/files.
  spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8', timeout: 15_000 });
  rmSync(directory, { recursive: true, force: true });
}
