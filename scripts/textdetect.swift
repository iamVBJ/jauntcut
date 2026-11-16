// Finds text in images with Apple Vision. One JSON line per image:
// {"file": ..., "text": [{"s": "string", "box": [x, y, w, h], "conf": 0-1}]}
// (box top-left origin, 0-1). Used by review.py to spot burned-in captions and
// watermarks in footage that was edited before it arrived.
// Usage: textdetect <image> [image ...]
import Foundation
import Vision

for path in CommandLine.arguments.dropFirst() {
    var out: [String: Any] = ["file": path]
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .fast
    req.usesLanguageCorrection = false
    let h = VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:])
    do {
        try h.perform([req])
        out["text"] = (req.results ?? []).compactMap { o -> [String: Any]? in
            guard let c = o.topCandidates(1).first else { return nil }
            let b = o.boundingBox
            let box: [Double] = [Double(b.minX), 1 - Double(b.maxY), Double(b.width), Double(b.height)]
            return ["s": c.string, "box": box.map { ($0 * 1000).rounded() / 1000 }, "conf": (Double(c.confidence) * 100).rounded() / 100]
        }
    } catch {
        out["error"] = "\(error)"
    }
    print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
}
