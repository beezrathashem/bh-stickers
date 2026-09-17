const { withInfoPlist } = require("expo/config-plugins");

/**
 * Expo config plugin for react-native-whatsapp-stickers-url.
 *
 * iOS: WhatsApp is opened through the `whatsapp://` URL scheme, and
 * `canOpenURL` only answers truthfully for schemes listed under
 * LSApplicationQueriesSchemes, so we add `whatsapp` there.
 *
 * Android needs nothing here: the library's own AndroidManifest.xml is merged
 * into the app and already declares the sticker ContentProvider (with the
 * `${applicationId}.stickercontentprovider` authority WhatsApp expects) and
 * the `<queries>` entries required for package visibility on Android 11+.
 */
const withWhatsAppStickers = (config) =>
  withInfoPlist(config, (config) => {
    const schemes = new Set(config.modResults.LSApplicationQueriesSchemes ?? []);
    schemes.add("whatsapp");
    config.modResults.LSApplicationQueriesSchemes = Array.from(schemes);
    return config;
  });

module.exports = withWhatsAppStickers;
