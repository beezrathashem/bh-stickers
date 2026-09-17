import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Downloads sticker images and normalises them into what WhatsApp accepts:
/// 512x512 WebP for stickers (<=100KB static, <=500KB animated) and a 96x96 PNG tray icon (<=50KB).
enum StickerImageProcessor {
  private static let webpUTI = "org.webmproject.webp"

  // MARK: Download

  static func download(_ urlString: String, label: String) throws -> Data {
    guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      throw StickerPackException("\(label): '\(urlString)' is not a valid http(s) URL")
    }

    var result: Result<Data, Error> = .failure(StickerPackException("\(label): download did not complete"))
    let semaphore = DispatchSemaphore(value: 0)
    var request = URLRequest(url: url)
    request.timeoutInterval = 30
    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      if let error = error {
        result = .failure(StickerPackException("\(label): download failed (\(error.localizedDescription))"))
        return
      }
      if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        result = .failure(StickerPackException("\(label): server answered HTTP \(http.statusCode) for \(urlString)"))
        return
      }
      guard let data = data, !data.isEmpty else {
        result = .failure(StickerPackException("\(label): empty response from \(urlString)"))
        return
      }
      result = .success(data)
    }.resume()
    semaphore.wait()
    return try result.get()
  }

  // MARK: Format sniffing

  static func isWebP(_ data: Data) -> Bool {
    guard data.count >= 12 else { return false }
    return data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46
      && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50
  }

  static func isPNG(_ data: Data) -> Bool {
    guard data.count >= 8 else { return false }
    return data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47
  }

  /// Pixel size and frame count, read from the container without decoding pixels.
  static func probe(_ data: Data) -> (width: Int, height: Int, frames: Int)? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let frames = CGImageSourceGetCount(source)
    guard frames > 0,
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = props[kCGImagePropertyPixelWidth] as? Int,
          let height = props[kCGImagePropertyPixelHeight] as? Int else {
      return nil
    }
    return (width, height, frames)
  }

  // MARK: Stickers

  /// Returns WebP bytes ready for WhatsApp, or throws with an actionable message.
  static func prepareSticker(_ data: Data, animated: Bool, label: String) throws -> Data {
    guard let info = probe(data) else {
      throw StickerPackException("\(label): file is not a decodable image")
    }
    let side = StickerLimits.stickerSide

    if animated {
      guard isWebP(data) else { throw StickerPackException("\(label): animated stickers must be WebP files") }
      guard info.frames > 1 else { throw StickerPackException("\(label): pack is marked animated but this WebP has a single frame") }
      guard info.width == side && info.height == side else {
        throw StickerPackException("\(label): animated stickers must be exactly \(side)x\(side), got \(info.width)x\(info.height)")
      }
      guard data.count <= StickerLimits.maxAnimatedStickerBytes else {
        throw StickerPackException("\(label): animated sticker is \(data.count / 1024)KB, WhatsApp allows at most \(StickerLimits.maxAnimatedStickerBytes / 1024)KB")
      }
      return data
    }

    guard info.frames == 1 else {
      throw StickerPackException("\(label): is animated but the pack is not marked `animated: true` (packs cannot mix static and animated stickers)")
    }

    // Fast path: already compliant.
    if isWebP(data) && info.width == side && info.height == side && data.count <= StickerLimits.maxStaticStickerBytes {
      return data
    }

    // Otherwise decode (ImageIO handles PNG and WebP), fit to 512x512 and re-encode as WebP.
    guard let image = UIImage(data: data) else {
      throw StickerPackException("\(label): could not decode image")
    }
    let canvas = fit(image, side: side)
    guard let cgImage = canvas.cgImage else {
      throw StickerPackException("\(label): could not rasterise image")
    }
    for quality in stride(from: 0.95, through: 0.4, by: -0.05) {
      guard let encoded = encodeWebP(cgImage, quality: quality) else {
        throw StickerPackException("\(label): this device cannot encode WebP. Serve the sticker as a \(side)x\(side) WebP file under \(StickerLimits.maxStaticStickerBytes / 1024)KB instead")
      }
      if encoded.count <= StickerLimits.maxStaticStickerBytes {
        return encoded
      }
    }
    throw StickerPackException("\(label): could not compress below \(StickerLimits.maxStaticStickerBytes / 1024)KB; simplify the artwork")
  }

  // MARK: Tray

  /// Returns PNG bytes of a 96x96 tray icon.
  static func prepareTray(_ data: Data) throws -> Data {
    guard let info = probe(data) else {
      throw StickerPackException("tray image: file is not a decodable image")
    }
    guard info.frames == 1 else {
      throw StickerPackException("tray image: must be a static image")
    }
    let side = StickerLimits.traySide
    if isPNG(data) && info.width == side && info.height == side && data.count <= StickerLimits.maxTrayBytes {
      return data
    }
    guard let image = UIImage(data: data) else {
      throw StickerPackException("tray image: could not decode image")
    }
    guard let png = fit(image, side: side).pngData() else {
      throw StickerPackException("tray image: could not encode PNG")
    }
    guard png.count <= StickerLimits.maxTrayBytes else {
      throw StickerPackException("tray image: \(png.count / 1024)KB exceeds the \(StickerLimits.maxTrayBytes / 1024)KB limit")
    }
    return png
  }

  // MARK: Helpers

  /// Draws `image` centred on a transparent `side`x`side` canvas at scale 1, preserving aspect ratio.
  private static func fit(_ image: UIImage, side: Int) -> UIImage {
    let target = CGSize(width: side, height: side)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: target, format: format)
    return renderer.image { _ in
      let size = image.size
      guard size.width > 0, size.height > 0 else { return }
      let ratio = min(target.width / size.width, target.height / size.height)
      let drawSize = CGSize(width: size.width * ratio, height: size.height * ratio)
      let origin = CGPoint(x: (target.width - drawSize.width) / 2, y: (target.height - drawSize.height) / 2)
      image.draw(in: CGRect(origin: origin, size: drawSize))
    }
  }

  private static func encodeWebP(_ image: CGImage, quality: Double) -> Data? {
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, webpUTI as CFString, 1, nil) else {
      return nil
    }
    let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return output as Data
  }
}
