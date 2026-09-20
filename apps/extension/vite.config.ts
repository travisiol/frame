import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = import.meta.dirname;

/**
 * Extension pages (popup / dashboard / approval) + background service worker.
 * The content script and inpage provider are built separately as IIFEs
 * (vite.content.config.ts / vite.inpage.config.ts) because MV3 content
 * scripts cannot be ES modules.
 */
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        approval: resolve(__dirname, "approval.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
