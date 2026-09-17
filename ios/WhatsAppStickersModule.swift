import ExpoModulesCore
import UIKit

public class WhatsAppStickersModule: Module {
  private static let pasteboardType = "net.whatsapp.third-party.sticker-pack"
  private static let pasteboardExpiration: TimeInterval = 60
  private static let whatsAppURL = URL(string: "whatsapp://")!
  private static let stickerPackURL = URL(string: "whatsapp://stickerPack")!
  private static let identifierPattern = try! NSRegularExpression(pattern: "^[\\w\\-.,'\\s]+$")

  public func definition() -> ModuleDefinition {
    Name("WhatsAppStickers")

    AsyncFunction("isWhatsAppAvailable") { () -> Bool in
      UIApplication.shared.canOpenURL(Self.whatsAppURL)
    }.runOnQueue(.main)

    AsyncFunction("addStickerPack") { (pack: StickerPackInput, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let json = try Self.buildPayload(pack)
          DispatchQueue.main.async {
            do {
              try Self.send(json)
              promise.resolve(["status": "sent"])
            } catch {
              promise.reject(error)
            }
          }
        } catch {
          promise.reject(error)
        }
      }
    }

    // WhatsApp on iOS offers no API to ask whether a pack is installed.
    AsyncFunction("isStickerPackAdded") { (_: String) -> Bool? in
      nil
    }

    // Nothing is cached on iOS; the pack lives on the pasteboard for 60 seconds only.
    AsyncFunction("removeStickerPack") { (_: String) in }
  }

  // MARK: Payload

  private static func buildPayload(_ pack: StickerPackInput) throws -> [String: Any] {
    try validateStrings(pack)

    guard pack.stickers.count >= StickerLimits.minStickers && pack.stickers.count <= StickerLimits.maxStickers else {
      throw StickerPackException("a pack needs between \(StickerLimits.minStickers) and \(StickerLimits.maxStickers) stickers, got \(pack.stickers.count)")
    }

    let trayData = try StickerImageProcessor.download(pack.trayImageUrl, label: "tray image")
    let trayPNG = try StickerImageProcessor.prepareTray(trayData)

    var stickers: [[String: Any]] = []
    for (index, sticker) in pack.stickers.enumerated() {
      let label = "sticker #\(index + 1)"
      guard !sticker.emojis.isEmpty, sticker.emojis.count <= StickerLimits.maxEmojis else {
        throw StickerPackException("\(label): needs 1 to \(StickerLimits.maxEmojis) emojis")
      }
      let maxA11y = pack.animated ? StickerLimits.maxAnimatedAccessibilityChars : StickerLimits.maxStaticAccessibilityChars
      if let text = sticker.accessibilityText, text.count > maxA11y {
        throw StickerPackException("\(label): accessibility text is longer than \(maxA11y) characters")
      }

      let raw = try StickerImageProcessor.download(sticker.imageUrl, label: label)
      let webp = try StickerImageProcessor.prepareSticker(raw, animated: pack.animated, label: label)

      var entry: [String: Any] = [
        "image_data": webp.base64EncodedString(),
        "emojis": sticker.emojis,
      ]
      if let text = sticker.accessibilityText, !text.isEmpty {
        entry["accessibility_text"] = text
      }
      stickers.append(entry)
    }

    var json: [String: Any] = [
      "identifier": pack.identifier,
      "name": pack.name,
      "publisher": pack.publisher,
      "tray_image": trayPNG.base64EncodedString(),
      "stickers": stickers,
    ]
    if pack.animated {
      json["animated_sticker_pack"] = true
    }
    if let link = pack.iosAppStoreLink, !link.isEmpty {
      json["ios_app_store_link"] = link
    }
    if let link = pack.androidPlayStoreLink, !link.isEmpty {
      json["android_play_store_link"] = link
    }
    return json
  }

  private static func validateStrings(_ pack: StickerPackInput) throws {
    for (label, value) in [("identifier", pack.identifier), ("name", pack.name), ("publisher", pack.publisher)] {
      guard !value.isEmpty else { throw StickerPackException("\(label) cannot be empty") }
      guard value.count <= StickerLimits.maxChars else {
        throw StickerPackException("\(label) must be at most \(StickerLimits.maxChars) characters")
      }
    }
    let range = NSRange(pack.identifier.startIndex..., in: pack.identifier)
    guard identifierPattern.firstMatch(in: pack.identifier, range: range) != nil, !pack.identifier.contains("..") else {
      throw StickerPackException("identifier may only contain letters, digits, spaces and _ - . , '")
    }
    for link in [pack.publisherWebsite, pack.privacyPolicyWebsite, pack.licenseAgreementWebsite, pack.iosAppStoreLink, pack.androidPlayStoreLink] {
      if let link = link, !link.isEmpty, !(link.hasPrefix("http://") || link.hasPrefix("https://")) {
        throw StickerPackException("link '\(link)' must start with http:// or https://")
      }
    }
  }

  // MARK: Hand-off to WhatsApp (main queue)

  private static func send(_ json: [String: Any]) throws {
    if let bundleId = Bundle.main.bundleIdentifier, bundleId.contains("WA.WAStickersThirdParty") {
      throw StickerPackException("the app bundle identifier must not contain WhatsApp's sample identifier")
    }
    guard UIApplication.shared.canOpenURL(whatsAppURL) else {
      throw StickerPackException("WhatsApp is not installed")
    }
    let data = try JSONSerialization.data(withJSONObject: json, options: [])
    UIPasteboard.general.setItems(
      [[pasteboardType: data]],
      options: [
        .localOnly: true,
        .expirationDate: Date(timeIntervalSinceNow: pasteboardExpiration),
      ]
    )
    UIApplication.shared.open(stickerPackURL, options: [:], completionHandler: nil)
  }
}
