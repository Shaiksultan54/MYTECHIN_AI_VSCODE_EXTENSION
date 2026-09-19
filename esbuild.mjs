import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Codicons ship as a CSS file plus a font. They are copied into `media/` so the
 * packaged .vsix carries them without bundling node_modules, and so the webview
 * only ever loads from `localResourceRoots`.
 */
async function copyCodicons() {
  const from = 'node_modules/@vscode/codicons/dist';
  const to = 'media/codicons';
  await mkdir(to, { recursive: true });
  for (const file of ['codicon.css', 'codicon.ttf']) {
    await cp(`${from}/${file}`, `${to}/${file}`);
  }
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode', 'playwright-core', 'chromium-bidi/lib/cjs/bidiMapper/BidiMapper', 'chromium-bidi/lib/cjs/cdp/CdpConnection'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

await copyCodicons();

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
