import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'node:sqlite': fileURLToPath(new URL('./test/node-sqlite-shim.ts', import.meta.url)),
    },
  },
});
