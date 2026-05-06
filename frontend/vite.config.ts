import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/get-files':       { target: 'http://localhost:8787', changeOrigin: true },
      '/analyze-file':    { target: 'http://localhost:8787', changeOrigin: true },
      '/filter-findings': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
