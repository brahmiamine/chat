import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `host: true` exposes the dev server on the LAN so phones/tablets can reach it.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
