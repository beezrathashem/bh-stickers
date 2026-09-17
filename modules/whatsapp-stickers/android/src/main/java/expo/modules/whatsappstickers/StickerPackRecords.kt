package expo.modules.whatsappstickers

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StickerInput : Record {
  @Field val imageUrl: String = ""
  @Field val emojis: List<String> = emptyList()
  @Field val accessibilityText: String? = null
}

class StickerPackInput : Record {
  @Field val identifier: String = ""
  @Field val name: String = ""
  @Field val publisher: String = ""
  @Field val trayImageUrl: String = ""
  @Field val publisherEmail: String? = null
  @Field val publisherWebsite: String? = null
  @Field val privacyPolicyWebsite: String? = null
  @Field val licenseAgreementWebsite: String? = null
  @Field val iosAppStoreLink: String? = null
  @Field val androidPlayStoreLink: String? = null
  @Field val animated: Boolean = false
  @Field val imageDataVersion: String = "1"
  @Field val stickers: List<StickerInput> = emptyList()
}

/** Limits published by WhatsApp: https://github.com/WhatsApp/stickers/tree/main/Android */
object StickerLimits {
  const val STICKER_SIDE = 512
  const val TRAY_SIDE = 96
  const val MAX_STATIC_STICKER_BYTES = 100 * 1024
  const val MAX_ANIMATED_STICKER_BYTES = 500 * 1024
  const val MAX_TRAY_BYTES = 50 * 1024
  const val MIN_STICKERS = 3
  const val MAX_STICKERS = 30
  const val MAX_EMOJIS = 3
  const val MAX_CHARS = 128
  const val MAX_STATIC_ACCESSIBILITY_CHARS = 125
  const val MAX_ANIMATED_ACCESSIBILITY_CHARS = 255
}

class StickerPackException(message: String) : CodedException("ERR_WHATSAPP_STICKERS", message, null)
