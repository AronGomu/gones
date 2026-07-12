import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repositoryRoot, 'dist/gones/browser');
const indexPath = resolve(outputDirectory, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');
const manifest = JSON.parse(await readFile(resolve(outputDirectory, 'manifest.webmanifest'), 'utf8'));

if (!indexHtml.includes('<base href="/gones/">')) {
  throw new Error('GitHub Pages build must use the /gones/ base href.');
}
if (manifest.start_url !== './' || manifest.scope !== './') {
  throw new Error('The PWA start URL and scope must stay relative to the GitHub Pages project path.');
}

await access(resolve(outputDirectory, 'pages/leagues.html'));
await copyFile(indexPath, resolve(outputDirectory, '404.html'));
await writeFile(resolve(outputDirectory, '.nojekyll'), '');
