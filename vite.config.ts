import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Expose EXPO_PUBLIC_* and VITE_* env vars so the same .env file works
// across both Expo mobile builds and Vite web preview.
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  server: {
    port: 5173,
    host: true,
  },
});
