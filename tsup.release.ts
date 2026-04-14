import { defineConfig, type Options } from 'tsup'

/**
 * Release build config — bundles ALL npm dependencies except LLM SDKs.
 *
 * CRITICAL: CJS deps like commander use require("events") internally.
 * In ESM output, esbuild creates a __require shim that can't resolve
 * Node builtins. Fix: inject createRequire at the top so the shim works.
 */

const cjsShim = `
import { createRequire as __dkc_createRequire } from 'module';
const require = __dkc_createRequire(import.meta.url);
`

const shared: Partial<Options> = {
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  dts: false,
  sourcemap: false,
  treeshake: true,
  external: ['@anthropic-ai/sdk', 'openai'],
  noExternal: [/(commander|chalk|dotenv|gray-matter|slugify|diff|glob|js-yaml|esprima|strip-bom-string|extend-shallow|is-extendable|section-matter|kind-of)/],
  banner: { js: cjsShim },
}

export default defineConfig([
  {
    ...shared,
    entry: {
      'index': 'src/index.ts',
      'hooks/session-start': 'src/hooks/session-start.ts',
      'hooks/session-end-collect': 'src/hooks/session-end-collect.ts',
      'hooks/post-tool-use': 'src/hooks/post-tool-use.ts',
      'hooks/pre-compact': 'src/hooks/pre-compact.ts',
      'hooks/post-compact': 'src/hooks/post-compact.ts',
    },
    clean: true,
  },
  {
    ...shared,
    entry: { 'cli/index': 'src/cli/index.ts' },
    clean: false,
    banner: { js: '#!/usr/bin/env node\n' + cjsShim },
    onSuccess: 'rm -rf dist/templates && cp -r src/templates dist/templates',
  },
])
