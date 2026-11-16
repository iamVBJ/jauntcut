// The depth the iPhone recorded with a photo (dual camera / LiDAR, stored in the HEIC as
// auxiliary disparity or depth data), as an upright 8-bit greyscale PNG: white = near.
//   phonedepth <photo.heic> <out.png> [width height]
// Exits 4 if the photo has no depth data. Default size 1080x1920.
import AVFoundation
import CoreImage
import Foundation
import ImageIO

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 2 || args.count == 4 else { fputs("usage: phonedepth <photo> <out.png> [w h]\n", stderr); exit(2) }
let W = args.count == 4 ? Int(args[2])! : 1080, H = args.count == 4 ? Int(args[3])! : 1920
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[0]) as CFURL, nil) else { fputs("can't read \(args[0])\n", stderr); exit(1) }
var info: [AnyHashable: Any]? = nil
var kind = "disparity"
if let d = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypeDisparity) as? [AnyHashable: Any] { info = d }
else if let d = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypeDepth) as? [AnyHashable: Any] { info = d; kind = "depth" }
guard let info else { fputs("no depth data in \(args[0])\n", stderr); exit(4) }
var depth = try AVDepthData(fromDictionaryRepresentation: info).converting(toDepthDataType: kCVPixelFormatType_DisparityFloat32)
// The depth map is stored in the sensor's orientation: turn it like the photo.
let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any]
let orient = (props?[kCGImagePropertyOrientation as String] as? UInt32).flatMap { CGImagePropertyOrientation(rawValue: $0) } ?? .up
depth = depth.applyingExifOrientation(orient)
let buf = depth.depthDataMap
CVPixelBufferLockBaseAddress(buf, .readOnly)
let bw = CVPixelBufferGetWidth(buf), bh = CVPixelBufferGetHeight(buf), stride = CVPixelBufferGetBytesPerRow(buf)
let base = CVPixelBufferGetBaseAddress(buf)!
var vals = [Float](repeating: 0, count: bw * bh)
for y in 0..<bh {
  let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
  for x in 0..<bw { let v = row[x]; vals[y * bw + x] = v.isFinite ? v : 0 }
}
CVPixelBufferUnlockBaseAddress(buf, .readOnly)
// Disparity is already "bigger = nearer". Robust range (1st-99th percentile).
let sorted = vals.sorted()
let lo = sorted[sorted.count / 100], hi = sorted[sorted.count * 99 / 100]
var bytes = [UInt8](repeating: 0, count: bw * bh)
for i in 0..<vals.count { bytes[i] = UInt8(max(0, min(255, (vals[i] - lo) / max(1e-6, hi - lo) * 255))) }
let cg = CGImage(width: bw, height: bh, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: bw, space: CGColorSpaceCreateDeviceGray(),
                 bitmapInfo: CGBitmapInfo(rawValue: 0), provider: CGDataProvider(data: Data(bytes) as CFData)!, decode: nil,
                 shouldInterpolate: true, intent: .defaultIntent)!
let scaled = CIImage(cgImage: cg).transformed(by: CGAffineTransform(scaleX: CGFloat(W) / CGFloat(bw), y: CGFloat(H) / CGFloat(bh)))
try CIContext().writePNGRepresentation(of: scaled.cropped(to: CGRect(x: 0, y: 0, width: W, height: H)), to: URL(fileURLWithPath: args[1]),
                                       format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
print("phone depth \(args[1]) \(W)x\(H) (\(kind) \(bw)x\(bh), quality \(depth.depthDataQuality == .high ? "high" : "low"), \(depth.isDepthDataFiltered ? "filtered" : "raw"))")
