import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:6070",
      "/healthz": "http://127.0.0.1:6070",
      "/projects": "http://127.0.0.1:6070",
    },
  },
  build: { outDir: path.resolve(import.meta.dirname, "../scripts/studio/static"), emptyOutDir: true },
});
