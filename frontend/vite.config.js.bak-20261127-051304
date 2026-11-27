import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['dev.hermeshaplease.com'],
    proxy: {
      '/api': 'http://127.0.0.1:8766',
      '/ws': {
        target: 'ws://127.0.0.1:8766',
        ws: true,
      },
      '/health': 'http://127.0.0.1:8766',
    },
  },
});
