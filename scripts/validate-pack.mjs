#!/usr/bin/env node
/**
 * Validates a sticker-pack JSON (local file or URL) against WhatsApp's rules
 * without needing a phone: downloads every image, sniffs its format, reads
 * its pixel size and checks byte sizes, counts and emoji limits.
 *
 *   node scripts/validate-pack.mjs https://example.org/whatsapp-stickers/packs.json
 *   node scripts/validate-pack.mjs ./example-pack.json
 *
 * Accepts either a single pack object, `{ "packs": [ ... ] }` or an array of packs.
 * Exit code 1 when anything is wrong.
 */
import { readFile } from "node:fs/promises";

const LIMITS = {
  side: 512,
  traySide: 96,
  staticBytes: 100 * 1024,
  animatedBytes: 500 * 1024,
  trayBytes: 50 * 1024,
  minStickers: 3,
  maxStickers: 30,
  maxEmojis: 3,
  maxChars: 128,
};
const IDENTIFIER = /^[\w\-.,'\s]+$/;

const source = process.argv[2];
if (!source) {
  console.error("usage: validate-pack.mjs <packs.json path or URL>");
  process.exit(2);
}

const loadJson = async (src) => {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
    return res.json();
  }
  return JSON.parse(await readFile(src, "utf8"));
};

const fetchBytes = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const sniff = (buf) => {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), animated: false };
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      const flags = buf[20];
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: "webp", width, height, animated: (flags & 0x02) !== 0 };
    }
    if (chunk === "VP8 ") {
      return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, animated: false };
    }
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { format: "webp", width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff), animated: false };
    }
    return { format: "webp", width: 0, height: 0, animated: false };
  }
  return { format: "unknown", width: 0, height: 0, animated: false };
};

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

const validatePack = async (pack, problems) => {
  const tag = `[${pack.identifier ?? "?"}]`;
  const err = (msg) => problems.push(`${tag} ${msg}`);

  for (const key of ["identifier", "name", "publisher"]) {
    const v = pack[key];
    if (typeof v !== "string" || !v) err(`${key} is missing`);
    else if (v.length > LIMITS.maxChars) err(`${key} longer than ${LIMITS.maxChars} chars`);
  }
  if (pack.identifier && (!IDENTIFIER.test(pack.identifier) || pack.identifier.includes(".."))) {
    err("identifier may only contain letters, digits, spaces and _ - . , '");
  }
  for (const key of ["publisherWebsite", "privacyPolicyWebsite", "licenseAgreementWebsite", "iosAppStoreLink", "androidPlayStoreLink"]) {
    if (pack[key] && !/^https?:\/\//.test(pack[key])) err(`${key} must start with http(s)://`);
  }

  if (!pack.trayImageUrl) err("trayImageUrl is missing");
  else {
    try {
      const buf = await fetchBytes(pack.trayImageUrl);
      const info = sniff(buf);
      if (info.format === "unknown") err("tray image is neither PNG nor WebP");
      if (info.animated) err("tray image must be static");
      if (info.width !== LIMITS.traySide || info.height !== LIMITS.traySide) {
        console.log(`${tag} note: tray is ${info.width}x${info.height}; the app will rescale it to ${LIMITS.traySide}x${LIMITS.traySide}`);
      }
    } catch (e) {
      err(`tray image download failed: ${e.message}`);
    }
  }

  const stickers = Array.isArray(pack.stickers) ? pack.stickers : [];
  if (stickers.length < LIMITS.minStickers || stickers.length > LIMITS.maxStickers) {
    err(`needs ${LIMITS.minStickers}-${LIMITS.maxStickers} stickers, has ${stickers.length}`);
  }

  const animatedPack = pack.animated === true;
  await Promise.all(
    stickers.map(async (sticker, i) => {
      const label = `sticker #${i + 1}`;
      const emojis = Array.isArray(sticker.emojis) ? sticker.emojis : [];
      if (emojis.length < 1 || emojis.length > LIMITS.maxEmojis) err(`${label}: needs 1-${LIMITS.maxEmojis} emojis`);
      if (!sticker.imageUrl) return err(`${label}: imageUrl is missing`);
      try {
        const buf = await fetchBytes(sticker.imageUrl);
        const info = sniff(buf);
        if (info.format === "unknown") return err(`${label}: neither PNG nor WebP`);
        if (animatedPack) {
          if (info.format !== "webp" || !info.animated) err(`${label}: animated pack needs animated WebP`);
          if (buf.length > LIMITS.animatedBytes) err(`${label}: ${kb(buf.length)} > ${kb(LIMITS.animatedBytes)}`);
          if (info.width !== LIMITS.side || info.height !== LIMITS.side) err(`${label}: ${info.width}x${info.height}, must be ${LIMITS.side}x${LIMITS.side}`);
        } else {
          if (info.animated) err(`${label}: animated file in a static pack`);
          const compliant = info.format === "webp" && info.width === LIMITS.side && info.height === LIMITS.side && buf.length <= LIMITS.staticBytes;
          if (!compliant) {
            console.log(`${tag} note: ${label} is ${info.format} ${info.width}x${info.height} ${kb(buf.length)}; the app will convert it to ${LIMITS.side}x${LIMITS.side} WebP <= ${kb(LIMITS.staticBytes)}`);
          }
        }
      } catch (e) {
        err(`${label}: download failed: ${e.message}`);
      }
    }),
  );
};

const main = async () => {
  const json = await loadJson(source);
  const packs = Array.isArray(json) ? json : Array.isArray(json.packs) ? json.packs : [json];
  const problems = [];
  for (const pack of packs) await validatePack(pack, problems);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nOK: ${packs.length} pack(s), ${packs.reduce((n, p) => n + (p.stickers?.length ?? 0), 0)} stickers validated.`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
