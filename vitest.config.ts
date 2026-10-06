import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    // every file boots its own in-memory MongoDB; run them one after another to keep memory/CPU modest
    fileParallelism: false,
    // mongoose must be loaded once, un-bundled, in the node runtime
    server: { deps: { external: [/node_modules\/mongoose/, /node_modules\/bcryptjs/, /node_modules\/pdfkit/] } },
  },
});
