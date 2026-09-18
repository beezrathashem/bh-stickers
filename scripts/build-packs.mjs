#!/usr/bin/env node
/**
 * Turns folders of sticker artwork into WhatsApp-ready packs + a packs.json.
 *
 *   node scripts/build-packs.mjs <input-dir> <output-dir> --base-url https://www.bhtorah.org/beezrathashem/whatsapp-stickers
 *
 * Input layout: one sub-folder per pack (folder name becomes the pack name), any PNG/JPG/WebP inside.
 * A flat folder of images is treated as a single pack (split into packs of 30).
 * Optional per-pack `pack.json` in the folder: { "name", "identifier", "publisher", "tray": "file.png",
 *   "emojis": { "file.png": ["🙏"] }, "accessibility": { "file.png": "Baruch HaShem" } }.
 *
 * Output: <output-dir>/<identifier>/tray.png, 01.webp, 02.webp, ... and <output-dir>/packs.json
 * ready to be copied into apps/nextjs/public/beezrathashem/whatsapp-stickers/ in kiruv.co.
 *
 * Images are padded (not cropped) onto a transparent 512x512 canvas, encoded as WebP and
 * compressed until <=100KB. The tray is the first sticker (or `tray`) scaled to 96x96 PNG.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const [inputDir, outputDir] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const baseUrl = (flag("--base-url", "https://www.bhtorah.org/beezrathashem/whatsapp-stickers")).replace(/\/$/, "");
const publisher = flag("--publisher", "BeEzrat HaShem");
const defaultEmoji = flag("--emoji", "🙏");
if (!inputDir || !outputDir) {
  console.error("usage: build-packs.mjs <input-dir> <output-dir> [--base-url URL] [--publisher NAME] [--emoji 🙏]");
  process.exit(2);
}

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const MAX_STICKER = 100 * 1024;
const MAX_TRAY = 50 * 1024;
const PER_PACK = 30;

const slug = (s) =>
  s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase() || "pack";

async function listImages(dir) {
  const names = (await readdir(dir)).filter((n) => IMAGE_RE.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return names.map((n) => path.join(dir, n));
}

async function toSticker(file) {
  const base = sharp(file, { animated: false }).rotate().resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha();
  for (let quality = 92; quality >= 40; quality -= 6) {
    const buf = await base.clone().webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer();
    if (buf.length <= MAX_STICKER) return buf;
  }
  // Last resort: lossy with reduced alpha quality.
  const buf = await base.clone().webp({ quality: 40, alphaQuality: 60, effort: 6 }).toBuffer();
  if (buf.length > MAX_STICKER) throw new Error(`${path.basename(file)}: cannot get under 100KB (${(buf.length / 1024).toFixed(0)}KB)`);
  return buf;
}

async function toTray(file) {
  const buf = await sharp(file, { animated: false }).rotate().resize(96, 96, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9, palette: true }).toBuffer();
  if (buf.length > MAX_TRAY) throw new Error(`${path.basename(file)}: tray exceeds 50KB`);
  return buf;
}

async function readPackMeta(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, "pack.json"), "utf8"));
  } catch {
    return {};
  }
}

async function buildPack({ dir, name, identifier, files, meta }) {
  if (files.length < 3) {
    console.warn(`skip "${name}": needs at least 3 stickers, has ${files.length}`);
    return [];
  }
  const chunks = [];
  for (let i = 0; i < files.length; i += PER_PACK) chunks.push(files.slice(i, i + PER_PACK));

  const packs = [];
  for (const [ci, chunk] of chunks.entries()) {
    const id = chunks.length > 1 ? `${identifier}_${ci + 1}` : identifier;
    const packName = chunks.length > 1 ? `${name} ${ci + 1}` : name;
    const outDir = path.join(outputDir, id);
    await mkdir(outDir, { recursive: true });

    const stickers = [];
    for (const [i, file] of chunk.entries()) {
      const fileName = `${String(i + 1).padStart(2, "0")}.webp`;
      await writeFile(path.join(outDir, fileName), await toSticker(file));
      const key = path.basename(file);
      stickers.push({
        imageUrl: `${baseUrl}/${id}/${fileName}`,
        emojis: meta.emojis?.[key] ?? [defaultEmoji],
        ...(meta.accessibility?.[key] ? { accessibilityText: meta.accessibility[key] } : {}),
      });
      process.stdout.write(`  ${id}/${fileName} <- ${key}\n`);
    }

    const trayFile = meta.tray ? path.join(dir, meta.tray) : chunk[0];
    await writeFile(path.join(outDir, "tray.png"), await toTray(trayFile));

    packs.push({
      identifier: id,
      name: packName,
      publisher: meta.publisher ?? publisher,
      trayImageUrl: `${baseUrl}/${id}/tray.png`,
      publisherWebsite: "https://www.beezrathashem.org",
      animated: false,
      imageDataVersion: "1",
      stickers,
    });
  }
  return packs;
}

async function main() {
  const entries = await readdir(inputDir);
  const subdirs = [];
  for (const e of entries) {
    if ((await stat(path.join(inputDir, e))).isDirectory()) subdirs.push(path.join(inputDir, e));
  }
  const groups = subdirs.length
    ? subdirs
    : [inputDir];

  const packs = [];
  for (const dir of groups) {
    const meta = await readPackMeta(dir);
    const name = meta.name ?? (dir === inputDir ? "BeEzrat HaShem Stickers" : path.basename(dir));
    const identifier = meta.identifier ?? `bh_${slug(name)}`;
    console.log(`pack "${name}" (${identifier})`);
    packs.push(...(await buildPack({ dir, name, identifier, files: await listImages(dir), meta })));
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "packs.json"), JSON.stringify({ packs }, null, 2) + "\n");
  console.log(`\nWrote ${packs.length} pack(s), ${packs.reduce((n, p) => n + p.stickers.length, 0)} stickers -> ${path.join(outputDir, "packs.json")}`);
  console.log("Next: copy the output folder contents into kiruv.co/apps/nextjs/public/beezrathashem/whatsapp-stickers/, then validate:");
  console.log(`  node scripts/validate-pack.mjs ${path.join(outputDir, "packs.json")}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
