import { build } from 'esbuild';
import { cpSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const adminSrc = join(root, 'src', 'server', 'admin');
const adminDist = join(root, 'src', 'server', 'admin-dist');

await build({
  entryPoints: [join(adminSrc, 'index.tsx')],
  bundle: true,
  outdir: adminDist,
  format: 'esm',
  jsx: 'automatic',
  minify: process.argv.includes('--minify'),
  loader: { '.css': 'css' },
  external: [],
});

// Copy index.html to admin-dist
cpSync(join(adminSrc, 'index.html'), join(adminDist, 'index.html'));
