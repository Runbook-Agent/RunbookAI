import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    // Keep node_modules external
    /^[^./]/,
  ],
  noExternal: [
    // Bundle all local imports
  ],
});
