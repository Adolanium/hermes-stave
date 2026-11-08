// Bundles src/plugin.jsx into ../desktop/plugin.js: one ESM file whose only imports are the three
// specifiers Hermes Desktop resolves (@hermes/plugin-sdk, react, react/jsx-runtime).
import { build } from 'esbuild'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, '..', 'desktop', 'plugin.js')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// abcjs 6.7 reads a TAB setting from every staff on the second and later lines, including staves that
// asked for no TAB (a null entry), and throws. Guard that one read at bundle time; the installed
// package stays untouched.
const ABCJS_TAB_FIX = {
  name: 'abcjs-tab-fix',
  setup(b) {
    b.onLoad({ filter: /abcjs[\\/]src[\\/]tablatures[\\/]abc_tablatures\.js$/ }, args => {
      const source = readFileSync(args.path, 'utf8')
      const bug = 'if (tabs[kk].params.firstStaffOnly) {'
      if (!source.includes(bug)) throw new Error('abcjs changed: re-check the TAB fix in scripts/build.mjs')
      return { contents: source.replace(bug, 'if (tabs[kk] && tabs[kk].params.firstStaffOnly) {'), loader: 'js' }
    })
  }
}

await build({
  entryPoints: [join(root, 'src', 'plugin.jsx')],
  outfile,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  minify: true,
  minifyIdentifiers: process.env.READABLE ? false : true,
  legalComments: 'eof',
  external: ['react', 'react/jsx-runtime', '@hermes/plugin-sdk'],
  loader: { '.woff2': 'dataurl' },
  banner: { js: `// Stave ${version} — built from desktop-src/ (npm ci && npm run build). Do not edit. Bundles abcjs (MIT, Paul Rosen and Gregory Dyke), Rough Notation (MIT, Preet Shihn) and the Bodoni Moda and Kalam fonts (SIL OFL 1.1); licenses in THIRD_PARTY_NOTICES.md.` },
  plugins: [ABCJS_TAB_FIX],
  logLevel: 'warning'
})
console.log(`wrote ${outfile} (${(statSync(outfile).size / 1024).toFixed(0)} KiB)`)
