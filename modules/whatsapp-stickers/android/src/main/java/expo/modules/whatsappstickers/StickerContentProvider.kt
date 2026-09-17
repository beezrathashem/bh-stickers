package expo.modules.whatsappstickers

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File

/**
 * Exposes downloaded sticker packs to WhatsApp.
 *
 * Column names, paths and the authority suffix are part of WhatsApp's contract
 * (https://github.com/WhatsApp/stickers/tree/main/Android) and must not change.
 */
class StickerContentProvider : ContentProvider() {
  companion object {
    const val AUTHORITY_SUFFIX = ".stickercontentprovider"

    private const val STICKER_PACK_IDENTIFIER_IN_QUERY = "sticker_pack_identifier"
    private const val STICKER_PACK_NAME_IN_QUERY = "sticker_pack_name"
    private const val STICKER_PACK_PUBLISHER_IN_QUERY = "sticker_pack_publisher"
    private const val STICKER_PACK_ICON_IN_QUERY = "sticker_pack_icon"
    private const val ANDROID_APP_DOWNLOAD_LINK_IN_QUERY = "android_play_store_link"
    private const val IOS_APP_DOWNLOAD_LINK_IN_QUERY = "ios_app_download_link"
    private const val PUBLISHER_EMAIL = "sticker_pack_publisher_email"
    private const val PUBLISHER_WEBSITE = "sticker_pack_publisher_website"
    private const val PRIVACY_POLICY_WEBSITE = "sticker_pack_privacy_policy_website"
    private const val LICENSE_AGREEMENT_WEBSITE = "sticker_pack_license_agreement_website"
    private const val IMAGE_DATA_VERSION = "image_data_version"
    private const val AVOID_CACHE = "whatsapp_will_not_cache_stickers"
    private const val ANIMATED_STICKER_PACK = "animated_sticker_pack"

    private const val STICKER_FILE_NAME_IN_QUERY = "sticker_file_name"
    private const val STICKER_FILE_EMOJI_IN_QUERY = "sticker_emoji"
    private const val STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY = "sticker_accessibility_text"

    private const val METADATA = "metadata"
    private const val STICKERS = "stickers"
    private const val STICKERS_ASSET = "stickers_asset"

    private const val METADATA_CODE = 1
    private const val METADATA_CODE_FOR_SINGLE_PACK = 2
    private const val STICKERS_CODE = 3
    private const val STICKERS_ASSET_CODE = 4

    fun authority(packageName: String): String = packageName + AUTHORITY_SUFFIX
  }

  private val matcher = UriMatcher(UriMatcher.NO_MATCH)
  private lateinit var authority: String

  override fun onCreate(): Boolean {
    val ctx = context ?: return false
    authority = authority(ctx.packageName)
    matcher.addURI(authority, METADATA, METADATA_CODE)
    matcher.addURI(authority, "$METADATA/*", METADATA_CODE_FOR_SINGLE_PACK)
    matcher.addURI(authority, "$STICKERS/*", STICKERS_CODE)
    // One wildcard rule covers tray icons and stickers; getImageFile() checks the file is really part of a pack.
    matcher.addURI(authority, "$STICKERS_ASSET/*/*", STICKERS_ASSET_CODE)
    return true
  }

  private fun packs(): List<StoredPack> = context?.let { StickerPackStore.load(it) } ?: emptyList()

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    return when (matcher.match(uri)) {
      METADATA_CODE -> packCursor(uri, packs())
      METADATA_CODE_FOR_SINGLE_PACK -> packCursor(uri, packs().filter { it.identifier == uri.lastPathSegment })
      STICKERS_CODE -> stickerCursor(uri, packs().firstOrNull { it.identifier == uri.lastPathSegment })
      else -> throw IllegalArgumentException("Unknown URI: $uri")
    }
  }

  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor? {
    if (matcher.match(uri) != STICKERS_ASSET_CODE) return null
    val file = getImageFile(uri) ?: return null
    val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    return AssetFileDescriptor(pfd, 0, file.length())
  }

  override fun getType(uri: Uri): String {
    return when (matcher.match(uri)) {
      METADATA_CODE -> "vnd.android.cursor.dir/vnd.$authority.$METADATA"
      METADATA_CODE_FOR_SINGLE_PACK -> "vnd.android.cursor.item/vnd.$authority.$METADATA"
      STICKERS_CODE -> "vnd.android.cursor.dir/vnd.$authority.$STICKERS"
      STICKERS_ASSET_CODE -> if (uri.lastPathSegment?.endsWith(".png") == true) "image/png" else "image/webp"
      else -> throw IllegalArgumentException("Unknown URI: $uri")
    }
  }

  private fun packCursor(uri: Uri, packs: List<StoredPack>): Cursor {
    val cursor = MatrixCursor(
      arrayOf(
        STICKER_PACK_IDENTIFIER_IN_QUERY,
        STICKER_PACK_NAME_IN_QUERY,
        STICKER_PACK_PUBLISHER_IN_QUERY,
        STICKER_PACK_ICON_IN_QUERY,
        ANDROID_APP_DOWNLOAD_LINK_IN_QUERY,
        IOS_APP_DOWNLOAD_LINK_IN_QUERY,
        PUBLISHER_EMAIL,
        PUBLISHER_WEBSITE,
        PRIVACY_POLICY_WEBSITE,
        LICENSE_AGREEMENT_WEBSITE,
        IMAGE_DATA_VERSION,
        AVOID_CACHE,
        ANIMATED_STICKER_PACK,
      ),
    )
    for (pack in packs) {
      cursor.newRow().apply {
        add(pack.identifier)
        add(pack.name)
        add(pack.publisher)
        add(pack.trayFileName)
        add(pack.androidPlayStoreLink ?: "")
        add(pack.iosAppStoreLink ?: "")
        add(pack.publisherEmail ?: "")
        add(pack.publisherWebsite ?: "")
        add(pack.privacyPolicyWebsite ?: "")
        add(pack.licenseAgreementWebsite ?: "")
        add(pack.imageDataVersion)
        add(0)
        add(if (pack.animated) 1 else 0)
      }
    }
    context?.let { cursor.setNotificationUri(it.contentResolver, uri) }
    return cursor
  }

  private fun stickerCursor(uri: Uri, pack: StoredPack?): Cursor {
    val cursor = MatrixCursor(arrayOf(STICKER_FILE_NAME_IN_QUERY, STICKER_FILE_EMOJI_IN_QUERY, STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY))
    pack?.stickers?.forEach { sticker ->
      cursor.addRow(arrayOf<Any>(sticker.fileName, sticker.emojis.joinToString(","), sticker.accessibilityText ?: ""))
    }
    context?.let { cursor.setNotificationUri(it.contentResolver, uri) }
    return cursor
  }

  /** Resolves `stickers_asset/<identifier>/<file>` to a file on disk, only if that file belongs to the pack. */
  private fun getImageFile(uri: Uri): File? {
    val ctx = context ?: return null
    val segments = uri.pathSegments
    if (segments.size != 3) return null
    val identifier = segments[1]
    val fileName = segments[2]
    if (identifier.isEmpty() || fileName.isEmpty() || identifier.contains("..") || fileName.contains("..")) return null
    val pack = StickerPackStore.load(ctx).firstOrNull { it.identifier == identifier } ?: return null
    val known = fileName == pack.trayFileName || pack.stickers.any { it.fileName == fileName }
    if (!known) return null
    val file = File(StickerPackStore.packDir(ctx, identifier), fileName)
    return if (file.exists()) file else null
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("Not supported")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Not supported")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Not supported")
}
