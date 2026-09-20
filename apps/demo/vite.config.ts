import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = import.meta.dirname;

/** Served at /demo/ on the public website; at / during local development. */
export default defineConfig(({ command }) => ({
  root: __dirname,
  envDir: resolve(__dirname, "../.."),
  base: command === "build" ? "/demo/" : "/",
  plugins: [react(), tailwindcss()],
  server: { port: 5397, strictPort: true },
  preview: { port: 5397 },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: false },
}));
