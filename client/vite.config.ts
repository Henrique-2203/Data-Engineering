import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // permite abrir pelo celular na mesma rede Wi-Fi
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
});
