import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
copyFileSync('manifest.json', 'dist/manifest.json')
copyFileSync('content.css', 'dist/content.css')

await build({
  entryPoints: ['src/content.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  outfile: 'dist/content.js',
  sourcemap: 'inline',
  logLevel: 'info',
})
