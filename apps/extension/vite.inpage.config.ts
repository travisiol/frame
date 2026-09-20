import { resolve } from "node:path";
import { defineConfig } from "vite";
import { BRAND } from "../../packages/config/src/brand.ts";
import { LOGO_PNG_64 } from "../../packages/ui/src/logo-data.ts";

const __dirname = import.meta.dirname;

/** Inpage provider: classic script injected into web pages. Brand values are baked in at build time. */
export default defineConfig({
  root: __dirname,
  publicDir: false,
  define: {
    __FRAME_NAME__: JSON.stringify(BRAND.name),
    __FRAME_RDNS__: JSON.stringify(BRAND.rdns),
    __FRAME_VERSION__: JSON.stringify(BRAND.version),
    __FRAME_ICON__: JSON.stringify(LOGO_PNG_64),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    sourcemap: false,
    minify: true,
    lib: {
      entry: resolve(__dirname, "src/inpage.ts"),
      formats: ["iife"],
      name: "FrameInpage",
      fileName: () => "inpage.js",
    },
    rollupOptions: { output: { extend: true, inlineDynamicImports: true } },
  },
});
