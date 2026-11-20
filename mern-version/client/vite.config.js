import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({
  server: { port: 5173, strictPort: true, proxy: {
    '/api': loadEnv(mode, process.cwd(), 'VITE_').VITE_API_PROXY || 'http://127.0.0.1:5000',
  } },
}));
