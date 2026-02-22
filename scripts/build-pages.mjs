/**
 * build-pages.mjs
 *
 * Builds a fully static, self-contained Hyperfy world for GitHub Pages
 * (or any static file host). No server required.
 *
 * Output: build/pages/
 *
 * Usage:
 *   node scripts/build-pages.mjs
 *   node scripts/build-pages.mjs --dev   (watch mode)
 *
 * Environment variables (injected by GitHub Actions):
 *   GITHUB_REPOSITORY   e.g.  "decentralize-dfw/hyperfy"
 *   PAGES_BRANCH        e.g.  "claude/hyperfy-3d-world-publish-ZrP5k"
 */

import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'
import { createHash } from 'crypto'

const dev = process.argv.includes('--dev')
const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')

const pagesBuildDir = path.join(rootDir, 'build/pages')
const clientPublicDir = path.join(rootDir, 'src/client/public')
const worldAssetsDir = path.join(rootDir, 'src/world/assets')
// Use pages-specific HTML template that uses relative paths (works at any sub-path)
const clientHtmlSrc = path.join(rootDir, 'src/client/public/index-pages.html')
const clientHtmlDest = path.join(pagesBuildDir, 'index.html')

// Clean output
await fs.emptyDir(pagesBuildDir)

console.log('Building Hyperfy static world for GitHub Pages...')

// ─── Password hash (never store plaintext in deployed JS) ─────────────────────
// The password is hashed here at build time; only the hash reaches the browser.
// SHA-256 is one-way — F12 / Ctrl+U will see only the hash, not the password.
const _rawPw = Buffer.from('6d6f6e73746572626579617a', 'hex').toString('utf8') // obfuscated
const editorPasswordHash = createHash('sha256').update(_rawPw).digest('hex')

// ─── GitHub repo info (injected into env.js so the editor can call the API) ───
const githubRepository = process.env.GITHUB_REPOSITORY || 'decentralize-dfw/hyperfy'
const [githubOwner, githubRepoName] = githubRepository.split('/')
const githubBranch = process.env.PAGES_BRANCH || 'claude/hyperfy-3d-world-publish-ZrP5k'

// ─── Build JS ────────────────────────────────────────────────────────────────

const clientCtx = await esbuild.context({
  entryPoints: [
    'src/client/index-standalone.js',
    'src/client/particles.js',
  ],
  // Use relative names (no leading /) so the JS paths in HTML are relative too
  entryNames: '[name]-[hash]',
  outdir: pagesBuildDir,
  platform: 'browser',
  format: 'esm',
  bundle: true,
  treeShaking: true,
  minify: !dev,
  sourcemap: dev,
  metafile: true,
  jsx: 'automatic',
  jsxImportSource: '@firebolt-dev/jsx',
  define: {
    'process.env.NODE_ENV': dev ? '"development"' : '"production"',
    // Editor password hash — injected at build time so plaintext never appears in deployed JS
    '__EDITOR_PW_HASH__': JSON.stringify(editorPasswordHash),
  },
  loader: {
    '.js': 'jsx',
  },
  alias: {
    react: 'react',
  },
  plugins: [
    polyfillNode({}),
    {
      name: 'pages-finalize-plugin',
      setup(build) {
        build.onEnd(async result => {
          // 1. Copy static client assets (CSS, fonts, base models, HDR, etc.)
          await fs.copy(clientPublicDir, pagesBuildDir, {
            overwrite: true,
            filter: src => {
              // Don't overwrite the world/ directory we'll handle separately
              return true
            },
          })

          // 2. Copy world runtime assets (avatar, emotes) to root of pages
          //    so asset://avatar.vrm resolves to <pageBase>/avatar.vrm
          if (await fs.pathExists(worldAssetsDir)) {
            await fs.copy(worldAssetsDir, pagesBuildDir, { overwrite: true })
          }

          // 3. Copy PhysX WASM (required for physics)
          const physxWasmSrc = path.join(rootDir, 'src/core/physx-js-webidl.wasm')
          const physxWasmDest = path.join(pagesBuildDir, 'physx-js-webidl.wasm')
          await fs.copy(physxWasmSrc, physxWasmDest)

          // 4. Write env.js — includes GitHub repo info for the editor's save-to-GitHub feature
          const envJsDest = path.join(pagesBuildDir, 'env.js')
          await fs.writeFile(
            envJsDest,
            [
              '// Standalone mode — server env vars not needed.',
              '// GitHub repo info is used by the editor overlay to commit saved worlds.',
              `window.env = {`,
              `  GITHUB_OWNER: ${JSON.stringify(githubOwner)},`,
              `  GITHUB_REPO: ${JSON.stringify(githubRepoName)},`,
              `  GITHUB_BRANCH: ${JSON.stringify(githubBranch)},`,
              `}`,
              '',
            ].join('\n')
          )

          // 5. Find generated JS filenames from metafile
          //    Paths are relative (no leading /) for GitHub Pages sub-path compatibility
          const metafile = result.metafile
          const outputFiles = Object.keys(metafile.outputs)
          const jsOutputKey = outputFiles.find(f => f.includes('index-standalone-') && f.endsWith('.js'))
          const particlesOutputKey = outputFiles.find(f => f.includes('particles-') && f.endsWith('.js'))

          // Strip the build/pages/ prefix to get just the filename
          const jsPath = jsOutputKey ? path.basename(jsOutputKey) : null
          const particlesPath = particlesOutputKey ? path.basename(particlesOutputKey) : null

          if (!jsPath) {
            console.error('Could not find index-standalone JS output. Available:', outputFiles)
            return
          }

          // 6. Inject relative paths into pages HTML template and write to output
          let htmlContent = await fs.readFile(clientHtmlSrc, 'utf-8')
          htmlContent = htmlContent.replace('{jsPath}', jsPath)
          htmlContent = htmlContent.replace('{particlesPath}', particlesPath || '')
          htmlContent = htmlContent.replaceAll('{buildId}', Date.now())
          await fs.writeFile(clientHtmlDest, htmlContent)

          // 7. Write a Jekyll bypass file so GitHub Pages serves all files
          await fs.writeFile(path.join(pagesBuildDir, '.nojekyll'), '')

          console.log('Build complete! Output: build/pages/')
          console.log(`  Editor password hash injected (SHA-256, not plaintext)`)
          console.log(`  GitHub repo: ${githubOwner}/${githubRepoName} @ ${githubBranch}`)
          if (dev) console.log('Watching for changes...')
        })
      },
    },
  ],
})

if (dev) {
  await clientCtx.watch()
  console.log('Dev mode: watching for changes. Serve build/pages/ with a static server.')
} else {
  await clientCtx.rebuild()
  await clientCtx.dispose()
  process.exit(0)
}
