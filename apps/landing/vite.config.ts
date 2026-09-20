import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = import.meta.dirname;

export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  server: { port: 5398, strictPort: true },
  preview: { port: 5398 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        download: resolve(__dirname, "download.html"),
      },
    },
  },
});
