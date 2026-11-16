// Visual similarity between images using Apple Vision feature prints.
// Prints a JSON matrix of pairwise distances (0 = identical; larger = more
// different). Used by scripts/qa.py to catch the same scene shown twice.
// Usage: featureprint <image> [image ...]
import Foundation
import Vision

var prints: [VNFeaturePrintObservation?] = []
for path in CommandLine.arguments.dropFirst() {
    let req = VNGenerateImageFeaturePrintRequest()
    let h = VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:])
    try? h.perform([req])
    prints.append(req.results?.first as? VNFeaturePrintObservation)
}
var m: [[Double]] = []
for a in prints {
    var row: [Double] = []
    for b in prints {
        var d: Float = -1
        if let a = a, let b = b { try? a.computeDistance(&d, to: b) }
        row.append((Double(d) * 1000).rounded() / 1000)
    }
    m.append(row)
}
let data = try! JSONSerialization.data(withJSONObject: m)
print(String(data: data, encoding: .utf8)!)
