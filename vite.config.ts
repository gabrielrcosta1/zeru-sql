import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  // Pre-bundle Monaco at server start (in the background) so opening the editor
  // doesn't trigger a late dependency re-optimization + full page reload — the
  // main cause of the intermittent ~20s stalls in dev.
  optimizeDeps: {
    include: ["monaco-editor", "@monaco-editor/react"],
  },
  build: {
    target: "es2021",
    sourcemap: false,
    rollupOptions: {
      // Keep concurrent file handles low so large dep graphs (monaco) don't
      // exhaust the OS file-descriptor limit on constrained environments.
      maxParallelFileOps: 3,
      output: {
        manualChunks: {
          monaco: ["monaco-editor", "@monaco-editor/react"],
        },
      },
    },
  },
});
