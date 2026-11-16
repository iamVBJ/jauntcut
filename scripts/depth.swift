// Relative depth of a photo (Depth Anything V2 Small, Apple's Core ML build, run locally).
//   depth <model.mlpackage> <image> <out.png> [width height]
// Writes an 8-bit greyscale PNG (default 1080x1920): white = near, black = far, scaled to
// the full range per image. The model takes 518x392; the upright photo is squashed to fit
// (keeping "up" up matters to the model) and the depth is stretched back.
// The compiled model is cached next to the package (<name>.mlmodelc).
import CoreML
import CoreImage
import Foundation
import Vision

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 3 || args.count == 5 else { fputs("usage: depth <model.mlpackage> <image> <out.png> [w h]\n", stderr); exit(2) }
let pkg = URL(fileURLWithPath: args[0])
let W = args.count == 5 ? Int(args[3])! : 1080, H = args.count == 5 ? Int(args[4])! : 1920
let cached = pkg.deletingPathExtension().appendingPathExtension("mlmodelc")
if !FileManager.default.fileExists(atPath: cached.path) {
  let tmp = try MLModel.compileModel(at: pkg)
  try FileManager.default.moveItem(at: tmp, to: cached)
}
let model = try VNCoreMLModel(for: MLModel(contentsOf: cached))
guard let image = CIImage(contentsOf: URL(fileURLWithPath: args[1]), options: [.applyOrientationProperty: true]) else { fputs("can't read \(args[1])\n", stderr); exit(1) }
let req = VNCoreMLRequest(model: model)
req.imageCropAndScaleOption = .scaleFill
try VNImageRequestHandler(ciImage: image, options: [:]).perform([req])
guard let obs = req.results?.first as? VNPixelBufferObservation else { fputs("no depth output\n", stderr); exit(3) }
let buf = obs.pixelBuffer
CVPixelBufferLockBaseAddress(buf, .readOnly)
let bw = CVPixelBufferGetWidth(buf), bh = CVPixelBufferGetHeight(buf), stride = CVPixelBufferGetBytesPerRow(buf)
let base = CVPixelBufferGetBaseAddress(buf)!
var vals = [Float](repeating: 0, count: bw * bh)
for y in 0..<bh {
  let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float16.self)
  for x in 0..<bw { vals[y * bw + x] = Float(row[x]) }
}
CVPixelBufferUnlockBaseAddress(buf, .readOnly)
// Robust range (1st-99th percentile) so a few outliers don't flatten the map.
let sorted = vals.sorted()
let lo = sorted[sorted.count / 100], hi = sorted[sorted.count * 99 / 100]
var bytes = [UInt8](repeating: 0, count: bw * bh)
for i in 0..<vals.count { bytes[i] = UInt8(max(0, min(255, (vals[i] - lo) / max(1e-6, hi - lo) * 255))) }
let provider = CGDataProvider(data: Data(bytes) as CFData)!
let cg = CGImage(width: bw, height: bh, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: bw, space: CGColorSpaceCreateDeviceGray(),
                 bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
let small = CIImage(cgImage: cg)
let scaled = small.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / CGFloat(bw), y: CGFloat(H) / CGFloat(bh)))
let ctx = CIContext()
try ctx.writePNGRepresentation(of: scaled.cropped(to: CGRect(x: 0, y: 0, width: W, height: H)), to: URL(fileURLWithPath: args[2]),
                               format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
print("depth \(args[2]) \(W)x\(H) (model \(bw)x\(bh))")
