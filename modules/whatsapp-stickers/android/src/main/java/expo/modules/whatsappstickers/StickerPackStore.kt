package expo.modules.whatsappstickers

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * A pack whose images have been downloaded to app storage. WhatsApp reads the images
 * through [StickerContentProvider] at any later time (even after the app is killed), so
 * both the metadata and the files must be persisted.
 */
data class StoredSticker(
  val fileName: String,
  val emojis: List<String>,
  val accessibilityText: String?,
)

data class StoredPack(
  val identifier: String,
  val name: String,
  val publisher: String,
  val trayFileName: String,
  val publisherEmail: String?,
  val publisherWebsite: String?,
  val privacyPolicyWebsite: String?,
  val licenseAgreementWebsite: String?,
  val iosAppStoreLink: String?,
  val androidPlayStoreLink: String?,
  val animated: Boolean,
  val imageDataVersion: String,
  val stickers: List<StoredSticker>,
)

object StickerPackStore {
  private const val ROOT_DIR = "whatsapp_stickers"
  private const val INDEX_FILE = "packs.json"
  private val lock = Any()

  fun rootDir(context: Context): File = File(context.filesDir, ROOT_DIR).apply { mkdirs() }

  fun packDir(context: Context, identifier: String): File = File(rootDir(context), identifier).apply { mkdirs() }

  fun load(context: Context): List<StoredPack> = synchronized(lock) {
    val index = File(rootDir(context), INDEX_FILE)
    if (!index.exists()) return emptyList()
    return try {
      val array = JSONArray(index.readText())
      (0 until array.length()).map { fromJson(array.getJSONObject(it)) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun upsert(context: Context, pack: StoredPack) = synchronized(lock) {
    val packs = load(context).filter { it.identifier != pack.identifier } + pack
    save(context, packs)
  }

  fun remove(context: Context, identifier: String) = synchronized(lock) {
    save(context, load(context).filter { it.identifier != identifier })
    File(rootDir(context), identifier).deleteRecursively()
  }

  private fun save(context: Context, packs: List<StoredPack>) {
    val array = JSONArray()
    packs.forEach { array.put(toJson(it)) }
    File(rootDir(context), INDEX_FILE).writeText(array.toString())
  }

  private fun toJson(pack: StoredPack): JSONObject = JSONObject().apply {
    put("identifier", pack.identifier)
    put("name", pack.name)
    put("publisher", pack.publisher)
    put("trayFileName", pack.trayFileName)
    putOpt("publisherEmail", pack.publisherEmail)
    putOpt("publisherWebsite", pack.publisherWebsite)
    putOpt("privacyPolicyWebsite", pack.privacyPolicyWebsite)
    putOpt("licenseAgreementWebsite", pack.licenseAgreementWebsite)
    putOpt("iosAppStoreLink", pack.iosAppStoreLink)
    putOpt("androidPlayStoreLink", pack.androidPlayStoreLink)
    put("animated", pack.animated)
    put("imageDataVersion", pack.imageDataVersion)
    put("stickers", JSONArray().apply {
      pack.stickers.forEach { sticker ->
        put(JSONObject().apply {
          put("fileName", sticker.fileName)
          put("emojis", JSONArray(sticker.emojis))
          putOpt("accessibilityText", sticker.accessibilityText)
        })
      }
    })
  }

  private fun fromJson(json: JSONObject): StoredPack {
    val stickersJson = json.getJSONArray("stickers")
    val stickers = (0 until stickersJson.length()).map { i ->
      val s = stickersJson.getJSONObject(i)
      val emojisJson = s.getJSONArray("emojis")
      StoredSticker(
        fileName = s.getString("fileName"),
        emojis = (0 until emojisJson.length()).map { emojisJson.getString(it) },
        accessibilityText = s.optString("accessibilityText").ifEmpty { null },
      )
    }
    return StoredPack(
      identifier = json.getString("identifier"),
      name = json.getString("name"),
      publisher = json.getString("publisher"),
      trayFileName = json.getString("trayFileName"),
      publisherEmail = json.optString("publisherEmail").ifEmpty { null },
      publisherWebsite = json.optString("publisherWebsite").ifEmpty { null },
      privacyPolicyWebsite = json.optString("privacyPolicyWebsite").ifEmpty { null },
      licenseAgreementWebsite = json.optString("licenseAgreementWebsite").ifEmpty { null },
      iosAppStoreLink = json.optString("iosAppStoreLink").ifEmpty { null },
      androidPlayStoreLink = json.optString("androidPlayStoreLink").ifEmpty { null },
      animated = json.optBoolean("animated", false),
      imageDataVersion = json.optString("imageDataVersion", "1"),
      stickers = stickers,
    )
  }
}
