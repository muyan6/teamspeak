import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

function phosphorWoff2OnlyPlugin(): Plugin {
  return {
    name: 'phosphor-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (normalizedId.includes('@phosphor-icons/web') && normalizedId.includes('.css')) {
        return {
          code: code.replace(/src:\s*[\s\S]*?url\([^)]*?\.woff2[^)]*?\)\s*format\([^)]+\)[\s\S]*?;/gi, (match) => {
            const woff2 = match.match(/url\([^)]*?\.woff2[^)]*?\)\s*format\([^)]+\)/i);
            return woff2 ? `src: ${woff2[0]};` : match;
          }),
          map: null,
        };
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), phosphorWoff2OnlyPlugin()],
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) {
            return 'vendor-echarts';
          }
          if (id.includes('node_modules/@phosphor-icons')) {
            return 'vendor-icons';
          }
        },
      },
    },
  },
});
