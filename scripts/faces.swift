// Face boxes of every image in a directory (Vision), for face-only grading (faceLift).
// Usage: faces <dir>  -> JSON {"0001.png": [[x, y, w, h, confidence], ...], ...}
// Boxes are fractions of the frame, top-left origin.
import Foundation
import Vision

let dir = URL(fileURLWithPath: CommandLine.arguments[1])
let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".png") }.sorted()
var out: [String: [[Double]]] = [:]
for f in files {
    let req = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(url: dir.appendingPathComponent(f), options: [:])
    try? handler.perform([req])
    out[f] = (req.results ?? []).map { o in
        let b = o.boundingBox  // bottom-left origin
        return [Double(b.minX), 1 - Double(b.maxY), Double(b.width), Double(b.height), Double(o.confidence)]
    }
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
