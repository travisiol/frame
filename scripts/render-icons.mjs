#!/usr/bin/env node
/**
 * Renders the FRAME mark to PNG at every size the extension, the website and
 * an X profile picture need. Zero dependencies: the mark is three axis-aligned
 * rectangles on a rounded tile, rasterised with 4×4 supersampling and written
 * with a minimal PNG encoder (zlib from Node).
 *
 * Geometry mirrors packages/ui/src/logo.tsx (64-unit grid).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TILE = [0x10, 0x13, 0x10];
const BORDER = [0x25, 0x2a, 0x25];
const MARK = [0xa8, 0xff, 0x60];
const TILE_RADIUS = 64 * 0.22;
// Mark rectangles in tile space (after translate(6,6) scale(0.8125)): [x0, y0, x1, y1]
const S = 0.8125;
const T = 6;
const RECTS = [
  [15, 12, 49, 22],
  [15, 12, 25, 52],
  [15, 31, 41, 41],
].map(([x0, y0, x1, y1]) => [T + x0 * S, T + y0 * S, T + x1 * S, T + y1 * S]);

function insideTile(x, y, inset = 0) {
  const r = TILE_RADIUS - inset;
  const lo = inset;
  const hi = 64 - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = x < lo + r ? lo + r : x > hi - r ? hi - r : x;
  const cy = y < lo + r ? lo + r : y > hi - r ? hi - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function insideMark(x, y) {
  return RECTS.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
}

function render(size, { transparent = true, border = size >= 48 } = {}) {
  const SS = 4;
  const px = new Uint8Array(size * size * 4);
  const unit = 64 / size;
  const borderWidth = Math.max(1, size / 64) * unit; // ~1 device pixel
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let tile = 0;
      let mark = 0;
      let edge = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS) * unit;
          const y = (py + (sy + 0.5) / SS) * unit;
          if (insideTile(x, y)) {
            tile++;
            if (border && !insideTile(x, y, borderWidth)) edge++;
            else if (insideMark(x, y)) mark++;
          }
        }
      }
      const n = SS * SS;
      const a = transparent ? tile / n : 1;
      const fEdge = edge / n;
      const fMark = mark / n;
      const fTile = Math.max(0, tile / n - fEdge - fMark);
      const base = transparent ? [0, 0, 0] : TILE;
      const denom = transparent ? Math.max(tile / n, 1e-6) : 1;
      const bg = transparent ? 0 : 1 - tile / n;
      const r = (TILE[0] * fTile + BORDER[0] * fEdge + MARK[0] * fMark + base[0] * bg) / denom;
      const g = (TILE[1] * fTile + BORDER[1] * fEdge + MARK[1] * fMark + base[1] * bg) / denom;
      const b = (TILE[2] * fTile + BORDER[2] * fEdge + MARK[2] * fMark + base[2] * bg) / denom;
      const i = (py * size + pxi) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, px);
}

// --- PNG encoder -----------------------------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101310"/><g transform="translate(6 6) scale(0.8125)"><path d="M15 12H49V22H25V52H15V12Z" fill="#A8FF60"/><path d="M15 31H41V41H15V31Z" fill="#A8FF60"/></g></svg>`;

const targets = [
  { dir: "apps/extension/public/icons", sizes: [16, 32, 48, 64, 128, 256] },
  { dir: "apps/landing/public/icons", sizes: [16, 32, 64, 180, 192, 512] },
  { dir: "apps/demo/public/icons", sizes: [32, 180] },
];
for (const t of targets) {
  const dir = resolve(root, t.dir);
  mkdirSync(dir, { recursive: true });
  for (const size of t.sizes) writeFileSync(resolve(dir, `icon-${size}.png`), render(size));
  writeFileSync(resolve(dir, "icon.svg"), SVG);
}
// X profile picture: opaque 400×400 (X crops to a circle; the tile radius keeps the mark inside).
writeFileSync(resolve(root, "apps/landing/public/icons/x-profile-400.png"), render(400, { transparent: false, border: false }));
console.log("✓ icons rendered:", targets.map((t) => `${t.dir} (${t.sizes.join(", ")})`).join("; "), "+ x-profile-400.png");
