# BH Stickers

Standalone iOS + Android app (Expo SDK 54) that lets people add **BeEzrat HaShem WhatsApp
sticker packs** to WhatsApp. Sticker images are **not** bundled in the app; they are downloaded
from URLs listed in a hosted `packs.json`, so packs can be added or changed without an app-store
release.

```
.
├── App.tsx, src/                 the app UI (one screen: pack list + "Add to WhatsApp")
├── modules/whatsapp-stickers/    local Expo module (Swift + Kotlin) that talks to WhatsApp
├── scripts/validate-pack.mjs     checks a packs.json against WhatsApp's rules from your computer
├── app.json, eas.json            app identity + EAS build profiles
└── assets/                       icon / splash
```

## Where the stickers live

The app reads `https://www.bhtorah.org/beezrathashem/whatsapp-stickers/packs.json`
(configurable in `app.json` → `extra.packsUrl`). That file and its README live in the
`kiruv.co` repo under `apps/nextjs/public/beezrathashem/whatsapp-stickers/`. Add images
(512x512 WebP/PNG, 96x96 tray), list them in `packs.json`, validate, deploy the site:

```sh
node scripts/validate-pack.mjs https://www.bhtorah.org/beezrathashem/whatsapp-stickers/packs.json
```

Have a folder of artwork? One command converts it (512x512 WebP, 96x96 tray, packs of 30) and writes `packs.json`:

```sh
node scripts/build-packs.mjs ~/path/to/sticker-folders ./out
# then copy ./out/* into kiruv.co/apps/nextjs/public/beezrathashem/whatsapp-stickers/ and deploy
```

Format: see `modules/whatsapp-stickers/example-pack.json`. Rules and field docs:
`modules/whatsapp-stickers/README.md`.

## Develop

```sh
pnpm install
npx expo prebuild --no-install     # generates ios/ and android/ (gitignored)
npx expo run:ios                   # needs Xcode
npx expo run:android               # needs Android Studio / SDK
```

The native module cannot run in Expo Go; use a dev build or a real build.

## Build & ship (EAS)

```sh
npx eas-cli build --platform all --profile preview      # installable test builds (APK + ad-hoc IPA)
npx eas-cli build --platform all --profile production   # store builds, build numbers auto-increment
npx eas-cli submit --platform ios --latest
npx eas-cli submit --platform android --latest
```

Store listings need a privacy policy URL (both stores) and the usual screenshots. Once the
app is live, put its store URLs into every pack's `iosAppStoreLink` / `androidPlayStoreLink`
so WhatsApp can link back to the app when stickers are forwarded.

## License

BSD-3-Clause. The native module includes code derived from WhatsApp's sample apps (BSD).
