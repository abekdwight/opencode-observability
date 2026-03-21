import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEFAULT_VITE_PORT = 5173;
const configuredVitePort = Number(process.env.OPENCODE_VITE_PORT);
const vitePort =
  Number.isInteger(configuredVitePort) && configuredVitePort > 0
    ? configuredVitePort
    : DEFAULT_VITE_PORT;

export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "web"),
  server: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: process.env.OPENCODE_VITE_PORT != null,
    proxy: {
      "/api": "http://127.0.0.1:3737",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/app"),
    emptyOutDir: false,
  },
});
