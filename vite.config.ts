import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "apps/extension", base: "./", plugins: [react()],
  build: {
    outDir: "../../dist/extension", emptyOutDir: true, target: "chrome116",
    rollupOptions: { input: resolve(__dirname, "apps/extension/sidepanel.html") },
    chunkSizeWarningLimit: 1000,
  },
});
