import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = `http://localhost:${process.env.SERVER_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: {
      '/mcp': { target, changeOrigin: true },
      '/ws': { target, ws: true },
    },
  },
});
