#!/usr/bin/env node
/**
 * Minimal, dependency-free ZIP writer (PKZIP 2.0, deflate) used to package the
 * extension for download. Deterministic: entries are sorted and timestamped
 * with a fixed date, so the same build always hashes the same.
 *
 *   import { zipDirectory } from "./zip.mjs";
 *   const buffer = zipDirectory("apps/extension/dist");
 *
 * CLI: node scripts/zip.mjs <dir> <out.zip>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS time/date for 2026-01-01 00:00:00 — fixed so archives are reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ path: relative(base, full).split(sep).join("/"), full });
  }
  return out;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/** Zips a directory (files at the archive root). Returns the archive as a Buffer. */
export function zipDirectory(dir) {
  const files = walk(dir);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const data = readFileSync(f.full);
    const name = Buffer.from(f.path, "utf8");
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const header = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // flags: UTF-8 names
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(body.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    locals.push(header, body);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0x0800),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(body.length),
        u32(data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset),
        name,
      ]),
    );
    offset += header.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, central, end]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error("usage: zip.mjs <dir> <out.zip>");
    process.exit(2);
  }
  const buf = zipDirectory(dir);
  writeFileSync(out, buf);
  console.log(`✓ ${out} (${buf.length} bytes)`);
}
