import ExpoModulesCore

struct StickerInput: Record {
  @Field var imageUrl: String = ""
  @Field var emojis: [String] = []
  @Field var accessibilityText: String?
}

struct StickerPackInput: Record {
  @Field var identifier: String = ""
  @Field var name: String = ""
  @Field var publisher: String = ""
  @Field var trayImageUrl: String = ""
  @Field var publisherEmail: String?
  @Field var publisherWebsite: String?
  @Field var privacyPolicyWebsite: String?
  @Field var licenseAgreementWebsite: String?
  @Field var iosAppStoreLink: String?
  @Field var androidPlayStoreLink: String?
  @Field var animated: Bool = false
  @Field var imageDataVersion: String = "1"
  @Field var stickers: [StickerInput] = []
}

/// Limits published by WhatsApp: https://github.com/WhatsApp/stickers/tree/main/iOS
enum StickerLimits {
  static let stickerSide = 512
  static let traySide = 96
  static let maxStaticStickerBytes = 100 * 1024
  static let maxAnimatedStickerBytes = 500 * 1024
  static let maxTrayBytes = 50 * 1024
  static let minStickers = 3
  static let maxStickers = 30
  static let maxEmojis = 3
  static let maxChars = 128
  static let maxStaticAccessibilityChars = 125
  static let maxAnimatedAccessibilityChars = 255
}

final class StickerPackException: GenericException<String> {
  override var code: String { "ERR_WHATSAPP_STICKERS" }
  override var reason: String { param }
}
