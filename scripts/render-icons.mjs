#!/usr/bin/env node
/**
 * Renders the FRAME logo (the artwork file in brand-src/, used as-is) to every
 * size the extension, the website, the web app and social profiles need, plus
 * the data URIs the UI and the EIP-6963 provider embed.
 *
 * The artwork is only ever cropped and scaled — never redrawn. Icons are
 * cropped to the mark's bounds (plus a margin) so the letter stays legible at
 * 16 px; "full" renders keep the original framing. When brand-src/banner.png
 * exists, the Open Graph card is a centre crop of it.
 *
 * Zero dependencies: a headless Chrome canvas does the decoding and resampling
 * (stepwise, high quality), exactly like the browser will display it.
 *
 *   node scripts/render-icons.mjs [--src brand-src/logo.png]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/headless.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const srcArg = args.includes("--src") ? args[args.indexOf("--src") + 1] : undefined;
const src = resolve(root, srcArg ?? ["brand-src/logo.png", "brand-src/logo.webp"].find((f) => existsSync(resolve(root, f))) ?? "brand-src/logo.png");
if (!existsSync(src)) {
  console.error(`No artwork at ${src}. Put the logo file in brand-src/ (png or webp).`);
  process.exit(2);
}
const banner = ["brand-src/banner.png", "brand-src/banner.webp"].map((f) => resolve(root, f)).find((f) => existsSync(f));
const asDataUri = (file) => {
  const mime = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[extname(file).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
};

/** [dir, sizes] — icons are cropped to the mark on its black tile. */
const OUTPUTS = [
  ["apps/extension/public/icons", [16, 32, 48, 64, 128, 256]],
  ["apps/landing/public/icons", [16, 32, 64, 180, 192, 512]],
  ["apps/web/public/icons", [32, 180]],
];

const PAGE_SETUP = `(() => {
  const img = window.__img;
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  // Bounds of the mark: anything clearly brighter than the black background.
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const hist = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], bb = d[i + 2], a = d[i + 3];
    if (a < 32) continue;
    const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
    if (lum > 22) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat > 0.6 && mx > 120) { const k = ((r >> 4) << 8) | ((gg >> 4) << 4) | (bb >> 4); hist.set(k, (hist.get(k) ?? 0) + 1); }
  }
  let best = null, bestN = 0;
  for (const [k, n] of hist) if (n > bestN) { bestN = n; best = k; }
  const hex = best === null ? null : "#" + [(best >> 8) & 15, (best >> 4) & 15, best & 15].map((v) => (v * 17).toString(16).padStart(2, "0")).join("");
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const side = Math.round(Math.max(bw, bh) * 1.28); // 14 % margin around the mark
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  window.__art = { W, H, bounds: { x0, y0, x1, y1 }, crop: { x: Math.round(cx - side / 2), y: Math.round(cy - side / 2), side }, color: hex };
  // Stepwise high-quality resample of a source rectangle into a w×h PNG on black.
  window.__resample = (source, sx, sy, sw, sh, w, h) => {
    let cur = document.createElement("canvas"); cur.width = sw; cur.height = sh;
    const ctx = cur.getContext("2d"); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    while (cur.width / 2 >= w * 2 && cur.height / 2 >= h * 2) {
      const next = document.createElement("canvas"); next.width = Math.round(cur.width / 2); next.height = Math.round(cur.height / 2);
      const nctx = next.getContext("2d"); nctx.imageSmoothingEnabled = true; nctx.imageSmoothingQuality = "high"; nctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
    }
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    const octx = out.getContext("2d"); octx.fillStyle = "#000"; octx.fillRect(0, 0, w, h);
    octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high"; octx.drawImage(cur, 0, 0, w, h);
    return out.toDataURL("image/png");
  };
  window.__render = (size, framing) => {
    const icon = framing === "icon";
    return window.__resample(img, icon ? window.__art.crop.x : 0, icon ? window.__art.crop.y : 0, icon ? window.__art.crop.side : W, icon ? window.__art.crop.side : H, size, size);
  };
  // Open Graph card, 1200×630: the banner's centre when there is one, else the mark centred on black.
  window.__og = (bannerUri) => new Promise((resolve) => {
    if (bannerUri) {
      const bn = new Image();
      bn.onload = () => {
        const bw = bn.naturalWidth, bh = bn.naturalHeight;
        const cropW = Math.min(bw, Math.round(bh * (1200 / 630)));
        const cropH = Math.min(bh, Math.round(cropW * (630 / 1200)));
        resolve(window.__resample(bn, Math.round((bw - cropW) / 2), Math.round((bh - cropH) / 2), cropW, cropH, 1200, 630));
      };
      bn.src = bannerUri;
      return;
    }
    const out = document.createElement("canvas"); out.width = 1200; out.height = 630;
    const ctx = out.getContext("2d"); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1200, 630);
    const tile = new Image();
    tile.onload = () => { ctx.drawImage(tile, 344, 59, 512, 512); resolve(out.toDataURL("image/png")); };
    tile.src = window.__render(512, "icon");
  });
  return true;
})()`;

const b = launch({ out: resolve(root, "captures/.icons"), width: 1400, height: 1400 });
let exitCode = 0;
try {
  const page = await b.open("about:blank");
  await b.evaluate(page, `(() => { document.body.style.margin = "0"; document.body.style.background = "#000"; window.__img = new Image(); window.__img.src = ${JSON.stringify(asDataUri(src))}; return true; })()`);
  await b.waitFor(page, `window.__img.complete && window.__img.naturalWidth > 0`, { label: "artwork decoded" });
  await b.evaluate(page, PAGE_SETUP);
  const art = await b.evaluate(page, `window.__art`);
  console.log(`artwork ${art.W}×${art.H} (${src.replace(root, ".")}), mark bounds ${art.bounds.x0},${art.bounds.y0} → ${art.bounds.x1},${art.bounds.y1}, icon crop ${art.crop.side}px, dominant colour ${art.color}`);

  const write = (file, dataUrl) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  };
  for (const [dir, sizes] of OUTPUTS) {
    for (const size of sizes) write(resolve(root, dir, `icon-${size}.png`), await b.evaluate(page, `window.__render(${size}, "icon")`));
    // SVG favicon: the same artwork wrapped, so <link rel="icon" type="image/svg+xml"> keeps working.
    const png256 = await b.evaluate(page, `window.__render(256, "icon")`);
    writeFileSync(resolve(root, dir, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" width="256" height="256"><image href="${png256}" xlink:href="${png256}" width="256" height="256"/></svg>`);
    console.log(`  ✓ ${dir}: ${sizes.join(", ")} + icon.svg`);
  }
  // Social: X profile picture, the Open Graph card, and the file as it is for anyone who wants it.
  write(resolve(root, "apps/landing/public/icons/x-profile-400.png"), await b.evaluate(page, `window.__render(400, "icon")`));
  write(resolve(root, "apps/landing/public/icons/og.png"), await b.evaluate(page, `window.__og(${JSON.stringify(banner ? asDataUri(banner) : null)})`));
  write(resolve(root, "apps/landing/public/icons/logo-full-640.png"), await b.evaluate(page, `window.__render(640, "full")`));
  console.log(`  ✓ x-profile-400.png, og.png (${banner ? "from the banner" : "logo on black"}), logo-full-640.png`);

  // Data URIs for the UI (Logo component) and the EIP-6963 provider icon.
  const uri128 = await b.evaluate(page, `window.__render(128, "icon")`);
  const uri64 = await b.evaluate(page, `window.__render(64, "icon")`);
  writeFileSync(
    resolve(root, "packages/ui/src/logo-data.ts"),
    `// Generated by scripts/render-icons.mjs from brand-src/ — do not edit by hand.
/** The FRAME logo, cropped to the mark on its black tile, 128 px. */
export const LOGO_PNG_128 = ${JSON.stringify(uri128)};
/** 64 px variant for places that must stay small (EIP-6963 provider icon). */
export const LOGO_PNG_64 = ${JSON.stringify(uri64)};
/** Dominant colour of the artwork, sampled from its pixels. */
export const LOGO_COLOR = ${JSON.stringify(art.color ?? "#A8FF60")};
`,
  );
  console.log(`  ✓ packages/ui/src/logo-data.ts (${Math.round(uri128.length / 1024)} KB + ${Math.round(uri64.length / 1024)} KB)`);
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  b.close();
  process.exit(exitCode);
}
