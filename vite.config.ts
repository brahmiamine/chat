import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `host: true` exposes the dev server on the LAN so phones/tablets can reach it.
// Relative base so the build works both at the site root and under GitHub Pages (/chat/).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
