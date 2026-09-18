import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The extension references `dist/index.js` and `dist/index.css` by exact name,
 * so hashing is turned off. Everything is inlined into one bundle: a webview
 * has no HTTP server to lazily fetch chunks from.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
        manualChunks: undefined
      }
    }
  }
});
