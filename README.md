# react-native-whatsapp-stickers-url

Add WhatsApp sticker packs to an Expo / React Native app **from remote image URLs**.
No stickers are bundled in the binary, so packs can be added or changed without an
app-store release.

Built on the [Expo Modules API](https://docs.expo.dev/modules/overview/) (Swift + Kotlin),
works with Expo SDK 50+ / React Native 0.73+, the New Architecture and `expo prebuild`.
Implements WhatsApp's current third-party sticker contract for
[iOS](https://github.com/WhatsApp/stickers/tree/main/iOS) and
[Android](https://github.com/WhatsApp/stickers/tree/main/Android), including animated packs.

## What it does

1. Downloads the tray icon and every sticker image.
2. Validates and normalises them to WhatsApp's requirements
   (512x512 WebP, <=100KB static / <=500KB animated, 96x96 PNG tray <=50KB, 3-30 stickers, 1-3 emojis).
   PNG or oversized static stickers are converted on-device; animated stickers must already be compliant WebP.
3. Hands the pack to WhatsApp
   - iOS: pasteboard payload + `whatsapp://stickerPack`.
   - Android: persists the pack, exposes it through the required `ContentProvider`, fires
     `com.whatsapp.intent.action.ENABLE_STICKER_PACK` and reports WhatsApp's answer.

## Install

```sh
# published from git; pin a commit or tag
pnpm add github:beezrathashem/bh-stickers#main
```

Add the config plugin to `app.json` / `app.config.ts`:

```js
plugins: ["react-native-whatsapp-stickers-url"]
```

Then run `npx expo prebuild` and rebuild the native app (EAS or locally). The plugin adds
`whatsapp` to `LSApplicationQueriesSchemes` on iOS; the Android manifest (content provider,
`<queries>`) is merged automatically from the library.

## Usage

```ts
import WhatsAppStickers from "react-native-whatsapp-stickers-url";

if (await WhatsAppStickers.isWhatsAppAvailable()) {
  const result = await WhatsAppStickers.addStickerPack({
    identifier: "bh_torah_1",
    name: "BeEzrat HaShem Torah",
    publisher: "BeEzrat HaShem",
    trayImageUrl: "https://cdn.example.org/stickers/bh_torah_1/tray.png",
    publisherWebsite: "https://beezrathashem.org",
    privacyPolicyWebsite: "https://beezrathashem.org/privacy",
    licenseAgreementWebsite: "https://beezrathashem.org/terms",
    iosAppStoreLink: "https://apps.apple.com/app/id1234567890",
    androidPlayStoreLink: "https://play.google.com/store/apps/details?id=com.beezrathashem",
    stickers: [
      { imageUrl: "https://cdn.example.org/stickers/bh_torah_1/01.webp", emojis: ["🙏"] },
      { imageUrl: "https://cdn.example.org/stickers/bh_torah_1/02.webp", emojis: ["📖", "✡️"] },
      { imageUrl: "https://cdn.example.org/stickers/bh_torah_1/03.webp", emojis: ["🕯️"] },
    ],
  });
  // result.status: "added" (Android confirmed) | "sent" (iOS, no confirmation possible) | "cancelled"
}
```

Errors are rejected with readable messages, e.g. `sticker #4: animated stickers must be exactly 512x512, got 500x500`.

### API

| Function | Notes |
| --- | --- |
| `isNativeModuleAvailable()` | `false` in binaries that don't link this module (safe for shared code). |
| `isWhatsAppAvailable()` | WhatsApp or WhatsApp Business installed. |
| `addStickerPack(pack)` | Download, validate, send. See `StickerPackInput` in `src/index.ts`. |
| `isStickerPackAdded(id)` | Android: asks WhatsApp. iOS: resolves `null` (no API). |
| `removeStickerPack(id)` | Android: deletes the cached files. iOS: no-op. |

### Updating a published pack

WhatsApp on Android caches sticker images. When you change the images of an existing
`identifier`, bump `imageDataVersion` (e.g. `"1"` -> `"2"`) so WhatsApp re-fetches them.

## Validate packs from your computer

```sh
node scripts/validate-pack.mjs https://your-cdn/whatsapp-stickers/packs.json
node scripts/validate-pack.mjs ./example-pack.json
```

Downloads every image and reports anything WhatsApp would reject. `example-pack.json`
shows the JSON shape used by the validator and by the BeEzrat HaShem app.

## Sticker art checklist (from WhatsApp)

- Stickers: exactly 512x512 px, transparent background, WebP (PNG is converted for static packs).
- Static <=100KB; animated <=500KB, WebP only, first frame = full image, 8ms min per frame, <=10s total.
- A pack is either all static or all animated.
- Tray icon: 96x96 px PNG/WebP, static, <=50KB.
- 3-30 stickers per pack, 1-3 emojis per sticker, up to 10 packs per app.
- WhatsApp recommends an 8px white (#FFFFFF) stroke around each sticker.

## License

BSD-3-Clause. Portions derived from WhatsApp's sample code (BSD).
