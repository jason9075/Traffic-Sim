import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves from /<repo>/
  base: process.env.CI ? '/traffic-sim/' : '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
