// Cuts the subject (people and what they ride, wear or hold: karts, helmets) out of
// images with Apple Vision.
//   subjectmask <image> <out.png>
//        mask PNG the size of the image, subject in the alpha channel (CSS masks use alpha)
//   subjectmask --cutout <W> <H> <in> <out> [<in> <out> ...]
//        the image itself scaled to WxH, transparent everywhere except the subject
//        (no subject: fully transparent). Used to put moving subjects back on top of text.
import CoreImage
import Foundation
import Vision

let ctx = CIContext()
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func subjectMask(_ image: CIImage) throws -> CIImage? {
  let handler = VNImageRequestHandler(ciImage: image, options: [:])
  let req = VNGenerateForegroundInstanceMaskRequest()
  try handler.perform([req])
  guard let obs = req.results?.first else { return nil }
  let buf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
  let m = CIImage(cvPixelBuffer: buf)
  return m.transformed(by: CGAffineTransform(scaleX: image.extent.width / m.extent.width, y: image.extent.height / m.extent.height))
}

func load(_ path: String) -> CIImage {
  guard let im = CIImage(contentsOf: URL(fileURLWithPath: path), options: [.applyOrientationProperty: true]) else {
    fputs("can't read \(path)\n", stderr); exit(1)
  }
  return im
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "--cutout" {
  guard args.count >= 5, (args.count - 3) % 2 == 0, let W = Double(args[1]), let H = Double(args[2]) else {
    fputs("usage: subjectmask --cutout W H in out [in out ...]\n", stderr); exit(2)
  }
  var found = 0
  for k in stride(from: 3, to: args.count, by: 2) {
    let image = load(args[k])
    let sx = W / image.extent.width, sy = H / image.extent.height
    let scaled = image.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
    var out = CIImage(color: .clear).cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
    if let m = try subjectMask(image) {
      found += 1
      let alpha = m.transformed(by: CGAffineTransform(scaleX: sx, y: sy)).applyingFilter("CIMaskToAlpha")
      out = scaled.applyingFilter("CIBlendWithAlphaMask", parameters: ["inputBackgroundImage": out, "inputMaskImage": alpha])
        .cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
    }
    try ctx.writePNGRepresentation(of: out, to: URL(fileURLWithPath: args[k + 1]), format: .RGBA8, colorSpace: srgb)
  }
  print("cutouts \((args.count - 3) / 2), subject found in \(found)")
} else {
  guard args.count == 2 else { fputs("usage: subjectmask <image> <out.png>\n", stderr); exit(2) }
  let image = load(args[0])
  guard let m = try subjectMask(image) else { fputs("no subject found\n", stderr); exit(3) }
  // CSS masks use alpha: put the subject in the alpha channel (opaque = subject).
  try ctx.writePNGRepresentation(of: m.applyingFilter("CIMaskToAlpha"), to: URL(fileURLWithPath: args[1]), format: .RGBA8, colorSpace: srgb)
  print("mask \(args[1]) \(Int(image.extent.width))x\(Int(image.extent.height))")
}
