import { resolve } from "node:path";
import { defineConfig } from "vite";
import { BRAND } from "../../packages/config/src/brand.ts";

const __dirname = import.meta.dirname;
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101310"/><g transform="translate(6 6) scale(0.8125)"><path d="M15 12H49V22H25V52H15V12Z" fill="#A8FF60"/><path d="M15 31H41V41H15V31Z" fill="#A8FF60"/></g></svg>`;

/** Inpage provider: classic script injected into web pages. Brand values are baked in at build time. */
export default defineConfig({
  root: __dirname,
  publicDir: false,
  define: {
    __FRAME_NAME__: JSON.stringify(BRAND.name),
    __FRAME_RDNS__: JSON.stringify(BRAND.rdns),
    __FRAME_VERSION__: JSON.stringify(BRAND.version),
    __FRAME_ICON__: JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`),
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
