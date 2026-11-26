import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径，打包产物可直接部署到任意静态目录（GitHub Pages / Vercel 子路径）
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
