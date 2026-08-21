import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4321',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4321',
        ws: true,
      },
    },
  },
});
