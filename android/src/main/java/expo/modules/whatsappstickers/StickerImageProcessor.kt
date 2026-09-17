package expo.modules.whatsappstickers

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Downloads sticker images and normalises them into what WhatsApp accepts:
 * 512x512 WebP for stickers (<=100KB static, <=500KB animated) and a 96x96 PNG tray icon (<=50KB).
 */
object StickerImageProcessor {
  private const val TIMEOUT_MS = 30_000

  // MARK: Download

  fun download(urlString: String, label: String): ByteArray {
    val url = try {
      URL(urlString)
    } catch (e: Exception) {
      throw StickerPackException("$label: '$urlString' is not a valid URL")
    }
    if (url.protocol != "http" && url.protocol != "https") {
      throw StickerPackException("$label: '$urlString' is not a valid http(s) URL")
    }
    val connection = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
      instanceFollowRedirects = true
    }
    try {
      val code = connection.responseCode
      if (code !in 200..299) {
        throw StickerPackException("$label: server answered HTTP $code for $urlString")
      }
      val bytes = connection.inputStream.use { it.readBytes() }
      if (bytes.isEmpty()) throw StickerPackException("$label: empty response from $urlString")
      return bytes
    } catch (e: StickerPackException) {
      throw e
    } catch (e: Exception) {
      throw StickerPackException("$label: download failed (${e.message ?: e.javaClass.simpleName})")
    } finally {
      connection.disconnect()
    }
  }

  // MARK: Format sniffing

  fun isWebP(data: ByteArray): Boolean =
    data.size >= 12 &&
      data[0] == 'R'.code.toByte() && data[1] == 'I'.code.toByte() && data[2] == 'F'.code.toByte() && data[3] == 'F'.code.toByte() &&
      data[8] == 'W'.code.toByte() && data[9] == 'E'.code.toByte() && data[10] == 'B'.code.toByte() && data[11] == 'P'.code.toByte()

  fun isPNG(data: ByteArray): Boolean =
    data.size >= 8 && data[0] == 0x89.toByte() && data[1] == 'P'.code.toByte() && data[2] == 'N'.code.toByte() && data[3] == 'G'.code.toByte()

  /** Animated WebP files use the extended (VP8X) header with the animation flag (bit 1) set. */
  fun isAnimatedWebP(data: ByteArray): Boolean {
    if (!isWebP(data) || data.size < 21) return false
    val isVP8X = data[12] == 'V'.code.toByte() && data[13] == 'P'.code.toByte() && data[14] == '8'.code.toByte() && data[15] == 'X'.code.toByte()
    return isVP8X && (data[20].toInt() and 0x02) != 0
  }

  private fun dimensions(data: ByteArray): Pair<Int, Int>? {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, options)
    if (options.outWidth <= 0 || options.outHeight <= 0) return null
    return options.outWidth to options.outHeight
  }

  // MARK: Stickers

  /** Returns WebP bytes ready for WhatsApp, or throws with an actionable message. */
  fun prepareSticker(data: ByteArray, animated: Boolean, label: String): ByteArray {
    val (width, height) = dimensions(data) ?: throw StickerPackException("$label: file is not a decodable image")
    val side = StickerLimits.STICKER_SIDE
    val isAnimatedFile = isAnimatedWebP(data)

    if (animated) {
      if (!isWebP(data)) throw StickerPackException("$label: animated stickers must be WebP files")
      if (!isAnimatedFile) throw StickerPackException("$label: pack is marked animated but this WebP has a single frame")
      if (width != side || height != side) {
        throw StickerPackException("$label: animated stickers must be exactly ${side}x$side, got ${width}x$height")
      }
      if (data.size > StickerLimits.MAX_ANIMATED_STICKER_BYTES) {
        throw StickerPackException("$label: animated sticker is ${data.size / 1024}KB, WhatsApp allows at most ${StickerLimits.MAX_ANIMATED_STICKER_BYTES / 1024}KB")
      }
      return data
    }

    if (isAnimatedFile) {
      throw StickerPackException("$label: is animated but the pack is not marked `animated: true` (packs cannot mix static and animated stickers)")
    }

    // Fast path: already compliant.
    if (isWebP(data) && width == side && height == side && data.size <= StickerLimits.MAX_STATIC_STICKER_BYTES) {
      return data
    }

    val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
      ?: throw StickerPackException("$label: could not decode image")
    val canvas = fit(bitmap, side)
    var quality = 95
    while (quality >= 40) {
      val encoded = encodeWebP(canvas, quality)
      if (encoded.size <= StickerLimits.MAX_STATIC_STICKER_BYTES) return encoded
      quality -= 5
    }
    throw StickerPackException("$label: could not compress below ${StickerLimits.MAX_STATIC_STICKER_BYTES / 1024}KB; simplify the artwork")
  }

  // MARK: Tray

  /** Returns PNG bytes of a 96x96 tray icon. */
  fun prepareTray(data: ByteArray): ByteArray {
    val (width, height) = dimensions(data) ?: throw StickerPackException("tray image: file is not a decodable image")
    if (isAnimatedWebP(data)) throw StickerPackException("tray image: must be a static image")
    val side = StickerLimits.TRAY_SIDE
    if (isPNG(data) && width == side && height == side && data.size <= StickerLimits.MAX_TRAY_BYTES) {
      return data
    }
    val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
      ?: throw StickerPackException("tray image: could not decode image")
    val out = ByteArrayOutputStream()
    fit(bitmap, side).compress(Bitmap.CompressFormat.PNG, 100, out)
    val png = out.toByteArray()
    if (png.size > StickerLimits.MAX_TRAY_BYTES) {
      throw StickerPackException("tray image: ${png.size / 1024}KB exceeds the ${StickerLimits.MAX_TRAY_BYTES / 1024}KB limit")
    }
    return png
  }

  // MARK: Helpers

  /** Draws `bitmap` centred on a transparent `side`x`side` canvas, preserving aspect ratio. */
  private fun fit(bitmap: Bitmap, side: Int): Bitmap {
    val target = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val ratio = minOf(side.toFloat() / bitmap.width, side.toFloat() / bitmap.height)
    val drawWidth = bitmap.width * ratio
    val drawHeight = bitmap.height * ratio
    val left = (side - drawWidth) / 2f
    val top = (side - drawHeight) / 2f
    Canvas(target).drawBitmap(
      bitmap,
      Rect(0, 0, bitmap.width, bitmap.height),
      RectF(left, top, left + drawWidth, top + drawHeight),
      Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG),
    )
    return target
  }

  private fun encodeWebP(bitmap: Bitmap, quality: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Bitmap.CompressFormat.WEBP_LOSSY
    } else {
      @Suppress("DEPRECATION")
      Bitmap.CompressFormat.WEBP
    }
    bitmap.compress(format, quality, out)
    return out.toByteArray()
  }
}
