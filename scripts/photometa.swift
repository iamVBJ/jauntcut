// Prints one JSON line per photo: GPS and capture time read straight from the
// file's EXIF via ImageIO (works on HEIC, JPG, PNG, no Spotlight needed).
// Usage: photometa <file> [file ...]
import Foundation
import ImageIO

for path in CommandLine.arguments.dropFirst() {
    var out: [String: Any] = ["file": path]
    if let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
       let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any] {
        if let gps = props[kCGImagePropertyGPSDictionary as String] as? [String: Any],
           let lat = gps[kCGImagePropertyGPSLatitude as String] as? Double,
           let lon = gps[kCGImagePropertyGPSLongitude as String] as? Double {
            out["lat"] = (gps[kCGImagePropertyGPSLatitudeRef as String] as? String) == "S" ? -lat : lat
            out["lon"] = (gps[kCGImagePropertyGPSLongitudeRef as String] as? String) == "W" ? -lon : lon
        }
        if let tiff = props[kCGImagePropertyTIFFDictionary as String] as? [String: Any] {
            let make = tiff[kCGImagePropertyTIFFMake as String] as? String ?? ""
            let model = tiff[kCGImagePropertyTIFFModel as String] as? String ?? ""
            let camera = "\(make) \(model)".trimmingCharacters(in: .whitespaces)
            if !camera.isEmpty { out["camera"] = camera }
        }
        if let exif = props[kCGImagePropertyExifDictionary as String] as? [String: Any],
           let dt = exif[kCGImagePropertyExifDateTimeOriginal as String] as? String {
            // "2026:10:10 18:17:26" + "+07:00" -> ISO 8601
            let offset = exif["OffsetTimeOriginal"] as? String ?? "Z"
            let parts = dt.split(separator: " ")
            if parts.count == 2 {
                out["time"] = parts[0].replacingOccurrences(of: ":", with: "-") + "T" + parts[1] + offset
            }
        }
    }
    let data = try! JSONSerialization.data(withJSONObject: out)
    print(String(data: data, encoding: .utf8)!)
}
