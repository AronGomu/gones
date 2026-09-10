import { defineConfig } from 'cypress';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const container = process.env.S6_OWNER_SMOKE_CONTAINER;
if (!/^gones-owner-smoke-\d+-\d+$/.test(container ?? '')) throw new Error('Run this fixture through npm run auth:owner:smoke.');
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error('Isolated owner fixture operation failed.');
  return result.stdout.trim();
};
const sql = statement => run('docker', ['exec', container, 'psql', '-U', 's6_fixture', '-d', 's6_fixture', '-At', '-c', statement]);

export default defineConfig({
  video: false, screenshotOnRunFailure: false,
  e2e: {
    supportFile: false, specPattern: 'cypress/owner-setup/*.cy.js',
    setupNodeEvents(on) {
      on('task', {
        ownerSetupLink() {
          const model = JSON.parse(sql("SELECT template_model_json FROM notification_outbox WHERE template_key = 'owner-setup' ORDER BY created_at DESC LIMIT 1"));
          const url = new URL(model.actionUrl);
          return url.pathname + url.hash;
        },
        ownerSetupState() {
          return { users: Number(sql('SELECT count(*) FROM asp_net_users')), admins: Number(sql("SELECT count(*) FROM asp_net_users WHERE global_role = 'Admin'")) };
        },
        ownerPromote() {
          const port = run('docker', ['port', container, '5432/tcp']).split(':').at(-1);
          run('dotnet', ['backend/src/Gones.Migrator/bin/Debug/net10.0/Gones.Migrator.dll', 'owner', 'promote'], {
            ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GONES_'))),
            DOTNET_ENVIRONMENT: 'Testing', GONES_DEPLOYMENT_ENVIRONMENT: 'testing', GONES_BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test',
            GONES_PUBLIC_APP_ORIGIN: 'https://owner-fixture.example',
            GONES_DB_CONNECTION: `Host=127.0.0.1;Port=${port};Database=s6_fixture;Username=s6_fixture;Password=s6-fixture-only`
          });
          return null;
        }
      });
    }
  }
});
