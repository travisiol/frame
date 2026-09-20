import { resolve } from "node:path";
import { defineConfig } from "vite";

const __dirname = import.meta.dirname;

/** Content script: classic script (IIFE), no imports at runtime. */
export default defineConfig({
  root: __dirname,
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    sourcemap: false,
    minify: true,
    lib: {
      entry: resolve(__dirname, "src/content.ts"),
      formats: ["iife"],
      name: "FrameContent",
      fileName: () => "content.js",
    },
    rollupOptions: { output: { extend: true, inlineDynamicImports: true } },
  },
});
