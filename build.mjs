// Bundles the renderer (src/renderer.js → dist/renderer.js) with esbuild.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['src/renderer.js'],
  bundle: true,
  outfile: 'dist/renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  sourcemap: true,
  minify: !watch && process.env.NODE_ENV === 'production',
  logLevel: 'info',
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
