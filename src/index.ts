import { requireOptionalNativeModule } from "expo-modules-core";

/** One sticker inside a pack. */
export interface StickerInput {
  /** Public URL of the sticker image. WebP is required for animated packs; PNG/WebP for static (PNG is converted natively). */
  imageUrl: string;
  /** 1 to 3 emojis WhatsApp uses to surface the sticker in search. */
  emojis: string[];
  /** Screen-reader description. Max 125 chars (static) / 255 chars (animated). */
  accessibilityText?: string;
}

/** A whole sticker pack, ready to be handed to WhatsApp. */
export interface StickerPackInput {
  /** Unique, stable id. Allowed: letters, digits, `_ - . , '` and spaces. Changing it creates a different pack in WhatsApp. */
  identifier: string;
  /** Pack title shown in WhatsApp (max 128 chars). */
  name: string;
  /** Publisher name shown in WhatsApp (max 128 chars). */
  publisher: string;
  /** Public URL of the tray icon. Normalised natively to a 96x96 PNG. */
  trayImageUrl: string;
  publisherEmail?: string;
  publisherWebsite?: string;
  privacyPolicyWebsite?: string;
  licenseAgreementWebsite?: string;
  /** Deep link back to the app in the App Store; shown by WhatsApp when a pack is forwarded. */
  iosAppStoreLink?: string;
  /** Deep link back to the app on Google Play; shown by WhatsApp when a pack is forwarded. */
  androidPlayStoreLink?: string;
  /** `true` when every sticker is an animated WebP. Packs cannot mix static and animated stickers. */
  animated?: boolean;
  /**
   * Bump this whenever the images of an already-published pack change so
   * WhatsApp (Android) re-fetches them instead of serving its cache.
   */
  imageDataVersion?: string;
  /** 3 to 30 stickers. Order here is the order shown in WhatsApp. */
  stickers: StickerInput[];
}

export type AddStickerPackStatus =
  /** Android: WhatsApp confirmed the pack was added. */
  | "added"
  /** iOS: the pack was placed on the pasteboard and WhatsApp was opened. iOS gives no confirmation back. */
  | "sent"
  /** Android: the user dismissed WhatsApp's confirmation dialog. */
  | "cancelled";

export interface AddStickerPackResult {
  status: AddStickerPackStatus;
}

interface NativeModule {
  isWhatsAppAvailable(): Promise<boolean>;
  addStickerPack(pack: StickerPackInput): Promise<AddStickerPackResult>;
  isStickerPackAdded(identifier: string): Promise<boolean | null>;
  removeStickerPack(identifier: string): Promise<void>;
}

// Optional so that apps sharing JS code but not linking this module keep working.
const Native = requireOptionalNativeModule<NativeModule>("WhatsAppStickers");

/** `true` when the native module is linked into this binary. */
export const isNativeModuleAvailable = (): boolean => Native != null;

const requireNative = (): NativeModule => {
  if (!Native) {
    throw new Error(
      "react-native-whatsapp-stickers-url: native module is not linked. Rebuild the app after installing the package.",
    );
  }
  return Native;
};

/** Whether WhatsApp (or WhatsApp Business on Android) is installed. */
export const isWhatsAppAvailable = async (): Promise<boolean> => {
  if (!Native) return false;
  return Native.isWhatsAppAvailable();
};

/**
 * Download every image in `pack`, validate it against WhatsApp's rules
 * (512x512, size limits, emoji count, ...) and hand the pack to WhatsApp.
 *
 * Rejects with a human-readable message when something is wrong with the pack
 * or WhatsApp is not installed.
 */
export const addStickerPack = (
  pack: StickerPackInput,
): Promise<AddStickerPackResult> => requireNative().addStickerPack(pack);

/**
 * Android only: asks WhatsApp whether the pack is currently added.
 * Resolves `null` on iOS (WhatsApp offers no way to ask) or when WhatsApp is
 * not installed.
 */
export const isStickerPackAdded = (
  identifier: string,
): Promise<boolean | null> => requireNative().isStickerPackAdded(identifier);

/**
 * Deletes the locally cached copy of a pack (Android keeps downloaded images
 * so WhatsApp can read them later; iOS keeps nothing).
 */
export const removeStickerPack = (identifier: string): Promise<void> =>
  requireNative().removeStickerPack(identifier);

const WhatsAppStickers = {
  isNativeModuleAvailable,
  isWhatsAppAvailable,
  addStickerPack,
  isStickerPackAdded,
  removeStickerPack,
};

export default WhatsAppStickers;
