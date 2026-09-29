import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

function phosphorWoff2OnlyPlugin(): Plugin {
  return {
    name: 'phosphor-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (normalizedId.includes('@phosphor-icons/web') && normalizedId.includes('.css')) {
        let compact = code;
        // 三种字重使用相同前景码点，由 bold 提供一份通用映射。
        // 保留完整图标名称集合，后台已有自定义图标不会因为裁剪而消失。
        if (normalizedId.includes('/bold/')) {
          compact = compact.replace(/\.ph-bold\.(ph-[\w-]+):before/g, '.$1:before');
        } else if (normalizedId.includes('/fill/')) {
          compact = compact.replace(/\.ph-fill\.ph-[\w-]+:before\s*\{[^}]*\}/g, '');
        } else if (normalizedId.includes('/duotone/')) {
          compact = compact.replace(/\.ph-duotone\.ph-[\w-]+:before\s*\{[^}]*\}/g, '')
            .replace(/\s*margin-left:\s*-1em;/g, '')
            + '\n.ph-duotone:before{opacity:.2}.ph-duotone:after{margin-left:-1em}\n';
        }
        return {
          code: compact.replace(/src:\s*[\s\S]*?url\([^)]*?\.woff2[^)]*?\)\s*format\([^)]+\)[\s\S]*?;/gi, (match) => {
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
