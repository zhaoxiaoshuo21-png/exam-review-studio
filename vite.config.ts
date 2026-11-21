import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Vite 单文件打包配置：输出零外链、支持本地 file:// 协议直接打开的 HTML。
 */
export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteSingleFile({
      removeViteModuleLoader: false,
    }),
  ],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
