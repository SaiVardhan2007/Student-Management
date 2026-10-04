import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true } },
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 600 },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.js',
      css: false,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{js,jsx}'],
        exclude: ['src/__tests__/**', 'src/test-setup.js', 'src/main.jsx'],
        reporter: ['text-summary', 'lcov'],
        // regression guard for unit tests; pages are additionally exercised by the Playwright suite in e2e/
        thresholds: { statements: 22, branches: 17, functions: 15, lines: 22 },
      },
    },
  };
});
