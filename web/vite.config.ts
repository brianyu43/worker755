import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5755,
    strictPort: true,
    // The shell (../shell) runs in the page's Web Worker.
    fs: { allow: ['.', '../shell'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8755', changeOrigin: false },
    },
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true },
});
