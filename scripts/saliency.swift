// Prints one JSON line per image: 16x9 (rows x cols) saliency grids (0-1) from
// Apple's Vision framework - "grid" = attention (where the eye goes), "objects" =
// objectness (distinct things) - plus "detail": a small sharp detail inside an
// otherwise plain cell (a plane or bird in the sky, a tower tip), which Vision
// misses at this size - and face boxes (x, y, w, h; top-left origin, 0-1). Used by scripts/layout.ts to keep text off
// the main subject and faces.
// Usage: saliency <image> [image ...]
import Foundation
import Vision
import CoreImage
import CoreGraphics

let ROWS = 16, COLS = 9

func gridOf(_ obs: VNSaliencyImageObservation) -> [[Double]] {
    let pb = obs.pixelBuffer
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    let stride = CVPixelBufferGetBytesPerRow(pb) / MemoryLayout<Float32>.size
    let base = CVPixelBufferGetBaseAddress(pb)!.assumingMemoryBound(to: Float32.self)
    var grid = [[Double]](repeating: [Double](repeating: 0, count: COLS), count: ROWS)
    var counts = grid
    for y in 0..<h {
        for x in 0..<w {
            let r = min(ROWS - 1, y * ROWS / h), c = min(COLS - 1, x * COLS / w)
            grid[r][c] = max(grid[r][c], Double(base[y * stride + x]))  // peak, so small objects count
            counts[r][c] += 1
        }
    }
    CVPixelBufferUnlockBaseAddress(pb, .readOnly)
    return grid.map { $0.map { (min(1, max(0, $0)) * 1000).rounded() / 1000 } }
}

// Per cell: 99.5th-percentile gradient vs the cell's median. A plain cell (median
// low) with a sharp peak holds a small object. Calibrated on the spa opener's plane.
func detailOf(_ url: URL) -> [[Double]]? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let w = 270, h = 480
    var px = [UInt8](repeating: 0, count: w * h)
    guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                              space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    var mag = [Double](repeating: 0, count: w * h)
    for y in 1..<(h - 1) {
        for x in 1..<(w - 1) {
            let gx = (Double(px[y * w + x + 1]) - Double(px[y * w + x - 1])) / 2
            let gy = (Double(px[(y + 1) * w + x]) - Double(px[(y - 1) * w + x])) / 2
            mag[y * w + x] = (gx * gx + gy * gy).squareRoot()
        }
    }
    var grid = [[Double]](repeating: [Double](repeating: 0, count: COLS), count: ROWS)
    for r in 0..<ROWS {
        for c in 0..<COLS {
            var cell: [Double] = []
            // Bitmap memory is top row first, so row r of the grid is the r-th band from the top.
            for y in (r * h / ROWS)..<((r + 1) * h / ROWS) {
                for x in (c * w / COLS)..<((c + 1) * w / COLS) { cell.append(mag[y * w + x]) }
            }
            cell.sort()
            let med = cell[cell.count / 2], peak = cell[Int(Double(cell.count - 1) * 0.995)]
            let v = med < 4 ? max(0, (peak - 6) / (med + 2)) / 15 : 0
            grid[r][c] = (min(1, v) * 1000).rounded() / 1000
        }
    }
    return grid
}

for path in CommandLine.arguments.dropFirst() {
    var out: [String: Any] = ["file": path]
    let url = URL(fileURLWithPath: path)
    let handler = VNImageRequestHandler(url: url, options: [:])
    let sal = VNGenerateAttentionBasedSaliencyImageRequest()
    let obj = VNGenerateObjectnessBasedSaliencyImageRequest()
    let faces = VNDetectFaceRectanglesRequest()
    do {
        try handler.perform([sal, obj, faces])
        if let o = sal.results?.first as? VNSaliencyImageObservation { out["grid"] = gridOf(o) }
        if let o = obj.results?.first as? VNSaliencyImageObservation { out["objects"] = gridOf(o) }
        if let d = detailOf(url) { out["detail"] = d }
        out["faces"] = (faces.results ?? []).map { f -> [Double] in
            let b = f.boundingBox  // bottom-left origin
            let v: [Double] = [Double(b.minX), 1 - Double(b.maxY), Double(b.width), Double(b.height)]
            return v.map { ($0 * 1000).rounded() / 1000 }
        }
    } catch {
        out["error"] = "\(error)"
    }
    let data = try! JSONSerialization.data(withJSONObject: out)
    print(String(data: data, encoding: .utf8)!)
}
