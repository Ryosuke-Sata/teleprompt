import { defineConfig } from 'vite';

// Relative paths also work for project Pages at /repository-name/.
export default defineConfig({
  base: './',
  esbuild: { legalComments: 'inline' },
  build: { target: 'es2022' },
  worker: { rollupOptions: { output: { banner: '/*! Kotoba: kuromoji.js dictionary loader modified to accept HTTP-decoded dictionaries. See vendor/KUROMOJI-LICENSE.txt, vendor/IPADIC-NOTICE.txt and vendor/THIRD-PARTY.txt. */' } } },
});
