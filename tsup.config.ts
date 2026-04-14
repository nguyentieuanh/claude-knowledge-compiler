import { defineConfig } from 'tsup'

export default defineConfig([
  // Library + hook scripts — no shebang
  {
    entry: {
      'index': 'src/index.ts',
      'hooks/session-start': 'src/hooks/session-start.ts',
      'hooks/session-end-collect': 'src/hooks/session-end-collect.ts',
      'hooks/post-tool-use': 'src/hooks/post-tool-use.ts',
      'hooks/pre-compact': 'src/hooks/pre-compact.ts',
      'hooks/post-compact': 'src/hooks/post-compact.ts',
    },
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    dts: { entry: 'src/index.ts' },
    sourcemap: true,
  },
  // CLI entry — needs shebang, built separately after clean
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    onSuccess: 'rm -rf dist/templates && cp -r src/templates dist/templates',
  },
])
