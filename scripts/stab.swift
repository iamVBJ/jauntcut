// Video stabiliser (clip.stabilize, run by `npm run derive`), like a gimbal in post:
// pass 1 measures the camera's motion between consecutive frames with Vision image
// registration (translation + roll, on a small copy); the path is smoothed with a
// Gaussian (keeps the intended walk / pan, removes the step bob and hand shake);
// pass 2 moves each full-size frame by (smoothed - measured) and zooms in a little
// so the moved edges stay outside the frame.
// Usage: stab <video> <startSeconds> <seconds> <zoom> <sigmaFrames>
//   writes BGRA frames to stdout; its JSON header (size, count, shake before/after)
//   goes to stderr.
// Usage: stab --measure <video>   prints the frame-to-frame jitter of a video (px RMS
//   of the high-frequency motion at 360 px wide), to check a result.
import AVFoundation
import CoreImage
import Foundation
import Vision

func fail(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(1) }
func note(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

let args = CommandLine.arguments
let measureOnly = args.count == 3 && args[1] == "--measure"
guard measureOnly || args.count == 6 else { fail("usage: stab <video> <start> <seconds> <zoom> <sigma> | stab --measure <video>") }
let path = measureOnly ? args[2] : args[1]
let start = measureOnly ? 0 : Double(args[2])!
let secs = measureOnly ? 1e9 : Double(args[3])!
// zoom: a number, or "auto" = just enough to keep the moved edges covered (at least
// 1.03, at most 1.15; past that the correction is clamped to what 1.15 can hide).
let zoomArg = measureOnly ? "1" : args[4]
let sigma = measureOnly ? 18 : Double(args[5])!

let asset = AVURLAsset(url: URL(fileURLWithPath: path))
let sem = DispatchSemaphore(value: 0)
var track: AVAssetTrack?
Task { track = try? await asset.loadTracks(withMediaType: .video).first; sem.signal() }
sem.wait()
guard let track else { fail("no video track") }

func reader() -> (AVAssetReader, AVAssetReaderTrackOutput) {
    let r = try! AVAssetReader(asset: asset)
    if !measureOnly {
        r.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600000), duration: CMTime(seconds: secs, preferredTimescale: 600000))
    }
    let o = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    o.alwaysCopiesSampleData = false
    r.add(o)
    guard r.startReading() else { fail("reader: \(String(describing: r.error))") }
    return (r, o)
}

let ctx = CIContext(options: [.workingColorSpace: NSNull()])
let smallW: CGFloat = 360

// Pass 1: motion between consecutive frames (on 360 px wide copies).
// dx, dy in small-frame pixels (Core Image coordinates, y up), da in radians.
var motion: [(dx: Double, dy: Double, da: Double)] = []
var W = 0, H = 0
do {
    let (r, o) = reader()
    var prev: CGImage?
    while let s = o.copyNextSampleBuffer() {
        guard let pb = CMSampleBufferGetImageBuffer(s) else { continue }
        W = CVPixelBufferGetWidth(pb); H = CVPixelBufferGetHeight(pb)
        let k = smallW / CGFloat(W)
        let img = CIImage(cvPixelBuffer: pb).transformed(by: CGAffineTransform(scaleX: k, y: k))
        // Register only the upper part of the frame (roofs, wires, hills, sky): people
        // walking through the street would pull the estimate along with them.
        let e = img.extent
        let roi = CGRect(x: e.minX + e.width * 0.04, y: e.minY + e.height * 0.42, width: e.width * 0.92, height: e.height * 0.54).integral
        let cg = ctx.createCGImage(img, from: roi)!
        let q = (x: Double(roi.minX - e.minX) + Double(roi.width) / 2, y: Double(roi.minY - e.minY) + Double(roi.height) / 2)
        let fc = (x: Double(e.width) / 2, y: Double(e.height) / 2)
        if let prev {
            // How the new frame must move to line up with the previous one.
            let req = VNHomographicImageRegistrationRequest(targetedCGImage: cg)
            try? VNImageRequestHandler(cgImage: prev).perform([req])
            if let m = (req.results?.first as? VNImageHomographicAlignmentObservation)?.warpTransform {
                // Affine part of the homography (column-major simd): rotation + translation.
                // Vision's transform turns about the region's corner; re-express it about the
                // frame centre, where pass 2 turns the frame: about the region centre q,
                // t_q = t + (M - I) q; about the frame centre c, t_c = t_q + (M - I)(c - q).
                let a = Double(m.columns.0.x), b = Double(m.columns.0.y)
                let c1 = Double(m.columns.1.x), d = Double(m.columns.1.y)
                let lx = Double(cg.width) / 2, ly = Double(cg.height) / 2
                let tqx = Double(m.columns.2.x) + (a - 1) * lx + c1 * ly
                let tqy = Double(m.columns.2.y) + b * lx + (d - 1) * ly
                let ox = fc.x - q.x, oy = fc.y - q.y
                let tx = tqx + (a - 1) * ox + c1 * oy
                let ty = tqy + b * ox + (d - 1) * oy
                motion.append((tx, ty, atan2(b, a)))
            } else {
                motion.append((0, 0, 0))
            }
        } else {
            motion.append((0, 0, 0))
        }
        prev = cg
    }
    if r.status == .failed { fail("reader: \(String(describing: r.error))") }
}
let n = motion.count
guard n > 1 else { fail("too few frames") }

// Cumulative camera path and its smoothed version.
var px = [Double](repeating: 0, count: n), py = px, pa = px
for i in 1..<n { px[i] = px[i - 1] + motion[i].dx; py[i] = py[i - 1] + motion[i].dy; pa[i] = pa[i - 1] + motion[i].da }
func smooth(_ v: [Double], _ s: Double) -> [Double] {
    let r = Int(ceil(s * 3))
    let w = (-r...r).map { exp(-Double($0 * $0) / (2 * s * s)) }
    return (0..<v.count).map { i in
        var t = 0.0, ws = 0.0
        for (j, k) in (-r...r).enumerated() {
            let idx = min(max(i + k, 0), v.count - 1)  // hold the ends
            t += v[idx] * w[j]; ws += w[j]
        }
        return t / ws
    }
}
// High-frequency shake: RMS of path minus its smoothed path (what stabilising removes).
func shake(_ v: [Double]) -> Double {
    let s = smooth(v, sigma)
    var sum = 0.0
    for j in 0..<v.count { let d: Double = v[j] - s[j]; sum += d * d }
    return (sum / Double(v.count)).squareRoot()
}
let before = hypot(shake(px), shake(py))
if measureOnly {
    if ProcessInfo.processInfo.environment["STAB_DUMP"] != nil {
        for j in 0..<n { print(String(format: "%.2f %.2f %.4f", px[j], py[j], pa[j])) }
    }
    print(String(format: "%.2f", before))
    exit(0)
}
let sx = smooth(px, sigma), sy = smooth(py, sigma), sa = smooth(pa, sigma)

// The largest correction needs this much zoom to keep the edges covered; report it.
let k = Double(W) / Double(smallW)
var need = 1.0
for i in 0..<n {
    let cx = abs(sx[i] - px[i]) * k, cy = abs(sy[i] - py[i]) * k
    need = max(need, 1 + 2 * max(cx / Double(W), cy / Double(H)) + abs(sa[i] - pa[i]) * 1.2)
}
let zoom = CGFloat(zoomArg == "auto" ? min(1.15, max(1.03, need)) : Double(zoomArg)!)
let limit = (Double(zoom) - 1) / 2  // largest shift (fraction of the frame) the zoom hides
note("{\"width\": \(W), \"height\": \(H), \"frames\": \(n), \"shakePx\": \(String(format: "%.2f", before)), \"zoom\": \(String(format: "%.3f", Double(zoom))), \"zoomNeeded\": \(String(format: "%.3f", need))}")

// Pass 2: move each frame onto the smooth path, zoom about the centre, write BGRA.
let (r2, o2) = reader()
let out = FileHandle.standardOutput
var pool: CVPixelBufferPool?
CVPixelBufferPoolCreate(nil, nil, [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H] as CFDictionary, &pool)
var i = 0
let c = CGPoint(x: CGFloat(W) / 2, y: CGFloat(H) / 2)
while let s = o2.copyNextSampleBuffer() {
    guard let pb = CMSampleBufferGetImageBuffer(s), i < n else { continue }
    // The frame sits at path p; move it by (s - p) in translation and roll.
    // Vision's motion is how the new frame must move to meet the previous one, so the
    // camera path is its negative: the frame moves by (measured - smoothed). Checked on
    // a synthetic shake (8.8 px -> 0.7 px).
    // Never move further than the zoom can hide (no smeared edges).
    let lx = limit * Double(W) * 0.9, ly = limit * Double(H) * 0.9
    let dx = CGFloat(min(lx, max(-lx, (px[i] - sx[i]) * k))), dy = CGFloat(min(ly, max(-ly, (py[i] - sy[i]) * k))), da = CGFloat(pa[i] - sa[i])
    let t = CGAffineTransform(translationX: -c.x, y: -c.y)
        .concatenating(CGAffineTransform(rotationAngle: da))
        .concatenating(CGAffineTransform(scaleX: zoom, y: zoom))
        .concatenating(CGAffineTransform(translationX: c.x + dx * zoom, y: c.y + dy * zoom))
    let img = CIImage(cvPixelBuffer: pb).clampedToExtent().transformed(by: t).cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
    var ob: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool!, &ob)
    ctx.render(img, to: ob!)
    CVPixelBufferLockBaseAddress(ob!, .readOnly)
    let base = CVPixelBufferGetBaseAddress(ob!)!, stride = CVPixelBufferGetBytesPerRow(ob!)
    var data = Data(capacity: W * 4 * H)
    for row in 0..<H { data.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: W * 4) }
    CVPixelBufferUnlockBaseAddress(ob!, .readOnly)
    out.write(data)
    i += 1
}
if i != n { fail("pass 2 read \(i) frames, pass 1 \(n)") }
