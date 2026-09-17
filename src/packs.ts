import Constants from "expo-constants";

import type { StickerPackInput } from "../modules/whatsapp-stickers/src";

/**
 * Packs are plain JSON hosted on the BeEzrat HaShem site so new stickers ship
 * without an app release. Edit the file, redeploy the site, done.
 * Format: `modules/whatsapp-stickers/example-pack.json`.
 */
const DEFAULT_PACKS_URL =
  "https://www.bhtorah.org/beezrathashem/whatsapp-stickers/packs.json";

export const PACKS_URL: string =
  (Constants.expoConfig?.extra?.packsUrl as string | undefined) ?? DEFAULT_PACKS_URL;

export interface AppLinks {
  website: string;
  getApp: string;
  contactEmail: string;
}

export const LINKS: AppLinks = {
  website: "https://www.beezrathashem.org",
  getApp: "https://www.beezrathashem.org/getapp",
  contactEmail: "info@beezrathashem.org",
  ...((Constants.expoConfig?.extra?.links as Partial<AppLinks> | undefined) ?? {}),
};

export async function fetchPacks(signal?: AbortSignal): Promise<StickerPackInput[]> {
  const res = await fetch(PACKS_URL, { signal, headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { packs?: StickerPackInput[] } | StickerPackInput[];
  const packs = Array.isArray(json) ? json : json.packs ?? [];
  return packs.filter((p) => p && p.identifier && Array.isArray(p.stickers));
}
