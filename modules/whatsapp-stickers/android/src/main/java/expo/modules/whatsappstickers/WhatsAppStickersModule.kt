package expo.modules.whatsappstickers

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors

class WhatsAppStickersModule : Module() {
  companion object {
    private const val CONSUMER_WHATSAPP = "com.whatsapp"
    private const val BUSINESS_WHATSAPP = "com.whatsapp.w4b"
    private const val ENABLE_STICKER_PACK_ACTION = "com.whatsapp.intent.action.ENABLE_STICKER_PACK"
    private const val EXTRA_STICKER_PACK_ID = "sticker_pack_id"
    private const val EXTRA_STICKER_PACK_AUTHORITY = "sticker_pack_authority"
    private const val EXTRA_STICKER_PACK_NAME = "sticker_pack_name"
    private const val EXTRA_VALIDATION_ERROR = "validation_error"
    private const val ADD_PACK_REQUEST_CODE = 0x57A5 // "WAS"
    private const val WHITELIST_QUERY_PATH = "is_whitelisted"
    private const val WHITELIST_AUTHORITY_SUFFIX = ".provider.sticker_whitelist_check"
    private val IDENTIFIER_PATTERN = Regex("^[\\w\\-.,'\\s]+$")
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val executor = Executors.newSingleThreadExecutor()

  /** Promise of the addStickerPack() call currently waiting for WhatsApp's activity result. */
  private var pendingPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("WhatsAppStickers")

    AsyncFunction("isWhatsAppAvailable") {
      installedWhatsAppPackages().isNotEmpty()
    }

    AsyncFunction("addStickerPack") { pack: StickerPackInput, promise: Promise ->
      executor.execute {
        try {
          val stored = downloadAndStore(pack)
          val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
          val targets = installedWhatsAppPackages()
          if (targets.isEmpty()) throw StickerPackException("WhatsApp is not installed")
          activity.runOnUiThread {
            try {
              launchAddIntent(activity, stored, targets)
              synchronized(this@WhatsAppStickersModule) {
                pendingPromise?.resolve(mapOf("status" to "cancelled"))
                pendingPromise = promise
              }
            } catch (e: Exception) {
              promise.reject(StickerPackException("could not open WhatsApp: ${e.message}"))
            }
          }
        } catch (e: StickerPackException) {
          promise.reject(e)
        } catch (e: Exception) {
          promise.reject(StickerPackException(e.message ?: e.javaClass.simpleName))
        }
      }
    }

    AsyncFunction("isStickerPackAdded") { identifier: String ->
      val installed = installedWhatsAppPackages()
      if (installed.isEmpty()) return@AsyncFunction null
      // Added means added in every installed WhatsApp flavour, matching WhatsApp's sample app.
      installed.all { isWhitelistedIn(it, identifier) }
    }

    AsyncFunction("removeStickerPack") { identifier: String ->
      StickerPackStore.remove(context, identifier)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != ADD_PACK_REQUEST_CODE) return@OnActivityResult
      val promise = synchronized(this@WhatsAppStickersModule) {
        val p = pendingPromise
        pendingPromise = null
        p
      } ?: return@OnActivityResult

      when (payload.resultCode) {
        Activity.RESULT_OK -> promise.resolve(mapOf("status" to "added"))
        else -> {
          val error = payload.data?.getStringExtra(EXTRA_VALIDATION_ERROR)
          if (error != null) {
            promise.reject(StickerPackException("WhatsApp rejected the pack: $error"))
          } else {
            promise.resolve(mapOf("status" to "cancelled"))
          }
        }
      }
    }
  }

  // MARK: Download + persist

  private fun downloadAndStore(pack: StickerPackInput): StoredPack {
    validateStrings(pack)
    if (pack.stickers.size < StickerLimits.MIN_STICKERS || pack.stickers.size > StickerLimits.MAX_STICKERS) {
      throw StickerPackException("a pack needs between ${StickerLimits.MIN_STICKERS} and ${StickerLimits.MAX_STICKERS} stickers, got ${pack.stickers.size}")
    }

    val trayPng = StickerImageProcessor.prepareTray(StickerImageProcessor.download(pack.trayImageUrl, "tray image"))

    val prepared = pack.stickers.mapIndexed { index, sticker ->
      val label = "sticker #${index + 1}"
      if (sticker.emojis.isEmpty() || sticker.emojis.size > StickerLimits.MAX_EMOJIS) {
        throw StickerPackException("$label: needs 1 to ${StickerLimits.MAX_EMOJIS} emojis")
      }
      val maxA11y = if (pack.animated) StickerLimits.MAX_ANIMATED_ACCESSIBILITY_CHARS else StickerLimits.MAX_STATIC_ACCESSIBILITY_CHARS
      if ((sticker.accessibilityText?.length ?: 0) > maxA11y) {
        throw StickerPackException("$label: accessibility text is longer than $maxA11y characters")
      }
      val bytes = StickerImageProcessor.prepareSticker(StickerImageProcessor.download(sticker.imageUrl, label), pack.animated, label)
      Triple("sticker_${(index + 1).toString().padStart(2, '0')}.webp", sticker, bytes)
    }

    // Write into a fresh directory so a half-finished download never leaves a broken pack behind.
    val dir = StickerPackStore.packDir(context, pack.identifier)
    dir.listFiles()?.forEach { it.delete() }
    val trayFileName = "tray.png"
    File(dir, trayFileName).writeBytes(trayPng)
    prepared.forEach { (fileName, _, bytes) -> File(dir, fileName).writeBytes(bytes) }

    val stored = StoredPack(
      identifier = pack.identifier,
      name = pack.name,
      publisher = pack.publisher,
      trayFileName = trayFileName,
      publisherEmail = pack.publisherEmail?.ifEmpty { null },
      publisherWebsite = pack.publisherWebsite?.ifEmpty { null },
      privacyPolicyWebsite = pack.privacyPolicyWebsite?.ifEmpty { null },
      licenseAgreementWebsite = pack.licenseAgreementWebsite?.ifEmpty { null },
      iosAppStoreLink = pack.iosAppStoreLink?.ifEmpty { null },
      androidPlayStoreLink = pack.androidPlayStoreLink?.ifEmpty { null },
      animated = pack.animated,
      imageDataVersion = pack.imageDataVersion,
      stickers = prepared.map { (fileName, sticker, _) -> StoredSticker(fileName, sticker.emojis, sticker.accessibilityText?.ifEmpty { null }) },
    )
    StickerPackStore.upsert(context, stored)
    return stored
  }

  private fun validateStrings(pack: StickerPackInput) {
    listOf("identifier" to pack.identifier, "name" to pack.name, "publisher" to pack.publisher).forEach { (label, value) ->
      if (value.isEmpty()) throw StickerPackException("$label cannot be empty")
      if (value.length > StickerLimits.MAX_CHARS) throw StickerPackException("$label must be at most ${StickerLimits.MAX_CHARS} characters")
    }
    if (!IDENTIFIER_PATTERN.matches(pack.identifier) || pack.identifier.contains("..")) {
      throw StickerPackException("identifier may only contain letters, digits, spaces and _ - . , '")
    }
    listOf(pack.publisherWebsite, pack.privacyPolicyWebsite, pack.licenseAgreementWebsite, pack.iosAppStoreLink, pack.androidPlayStoreLink)
      .filterNotNull()
      .filter { it.isNotEmpty() }
      .forEach { link ->
        if (!link.startsWith("http://") && !link.startsWith("https://")) {
          throw StickerPackException("link '$link' must start with http:// or https://")
        }
      }
  }

  // MARK: WhatsApp interop

  private fun installedWhatsAppPackages(): List<String> {
    val pm = context.packageManager
    return listOf(CONSUMER_WHATSAPP, BUSINESS_WHATSAPP).filter { pkg ->
      try {
        pm.getPackageInfo(pkg, 0)
        true
      } catch (e: PackageManager.NameNotFoundException) {
        false
      }
    }
  }

  private fun launchAddIntent(activity: Activity, pack: StoredPack, targets: List<String>) {
    val intent = Intent(ENABLE_STICKER_PACK_ACTION).apply {
      putExtra(EXTRA_STICKER_PACK_ID, pack.identifier)
      putExtra(EXTRA_STICKER_PACK_AUTHORITY, StickerContentProvider.authority(context.packageName))
      putExtra(EXTRA_STICKER_PACK_NAME, pack.name)
    }
    if (targets.size == 1) {
      intent.setPackage(targets.first())
      activity.startActivityForResult(intent, ADD_PACK_REQUEST_CODE)
    } else {
      // Both WhatsApp and WhatsApp Business are installed: let the user pick.
      activity.startActivityForResult(Intent.createChooser(intent, "Add to WhatsApp"), ADD_PACK_REQUEST_CODE)
    }
  }

  private fun isWhitelistedIn(whatsAppPackage: String, identifier: String): Boolean {
    val uri = Uri.Builder()
      .scheme("content")
      .authority(whatsAppPackage + WHITELIST_AUTHORITY_SUFFIX)
      .appendPath(WHITELIST_QUERY_PATH)
      .appendQueryParameter("authority", StickerContentProvider.authority(context.packageName))
      .appendQueryParameter("identifier", identifier)
      .build()
    return try {
      context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        cursor.moveToFirst() && cursor.getInt(cursor.getColumnIndexOrThrow("result")) == 1
      } ?: false
    } catch (e: Exception) {
      false
    }
  }
}
