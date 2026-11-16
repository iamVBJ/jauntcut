"""Grade matching: one look across the whole reel.

Usage: python3 scripts/grade_match.py <slug>   (renders the QA frames itself)

Measures every clip's white balance (temp/tint of neutral pixels, same as review/qa),
brightness and saturation on the QA frames (rendered with the current grade, black
letterbox bars ignored), takes the reel's median as the target, and prints the per-clip
`grade: {...}` that brings each clip to it. The corrections are added to whatever grade
the clip already has, so run it again after applying to see what is left (it converges).
Advisory only: it prints suggestions, never edits a reel. Matching everything to the
median can flatten a reel (brighter, lost shadows, muted or pushed saturation):
judge each suggestion by eye and keep the real tone of each place.
Exposure is matched halfway (a dark garage and a bright track should stay a little
different); white balance, tint and saturation fully.
"""
import json, sys
import numpy as np
from PIL import Image

slug = sys.argv[1]
import subprocess
# One frame at the start, middle and end of every clip, rendered with the current grade.
qa = json.loads(subprocess.run(["npx", "tsx", "scripts/qa-frames.ts", slug], capture_output=True, text=True,
                               check=True).stdout.strip().splitlines()[-1])
# The reel as parsed (current per-clip grades and the reel grade).
reel = json.loads(subprocess.run(["npx", "tsx", "-e", f"""
import {{ reelSchema }} from "./src/schema"; import {{ topics }} from "./src/topics.generated";
console.log(JSON.stringify(reelSchema.parse(topics.find((t) => t.slug === "{slug}"))));"""], capture_output=True, text=True, check=True).stdout)


def measure(paths):
    t, i, l, s = [], [], [], []
    for p in paths:
        a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
        rows = a.reshape(a.shape[0], -1).max(1) > 12          # drop black bar rows
        a = a[rows].reshape(-1, 3)
        mx, mn = a.max(1), a.min(1)
        n = a[(mx - mn < 0.25 * (mx + 1)) & (mx > 60) & (mx < 235)]
        if len(n) > 200:
            r, g, b = n.mean(0)
            tot = r + g + b
            t.append((r - b) / tot)
            i.append((g - (r + b) / 2) / tot)
        l.append(float((a @ np.array([0.299, 0.587, 0.114])).mean()))
        s.append(float(((mx - mn) / (mx + 1)).mean()))
    m = lambda v: float(np.mean(v)) if v else None
    return m(t), m(i), m(l), m(s)


clips = qa["clips"]
rows = [(c["n"], c["src"], *measure(c["files"])) for c in clips]
T = float(np.median([r[2] for r in rows if r[2] is not None]))
I = float(np.median([r[3] for r in rows if r[3] is not None]))
L = float(np.median([r[4] for r in rows]))
S = float(np.median([r[5] for r in rows]))
print(f"target  temp {T:+.3f}  tint {I:+.3f}  luma {L:.0f}  sat {S:.3f}")
cur = {k + 1: (c.get("grade") if isinstance(c.get("grade"), dict) else {}) for k, c in enumerate(reel["clips"])}
for n, src, t, i, l, s in rows:
    g = dict(cur.get(n, {}))
    adj = {}
    if t is not None:
        adj["temperature"] = round(g.get("temperature", 0) - (t - T) / 0.1, 2)
    if i is not None:
        adj["tint"] = round(g.get("tint", 0) + (i - I) / 0.1, 2)
    adj["exposure"] = round(g.get("exposure", 0) + 0.5 * float(np.log2(L / max(l, 1))), 2)
    base_sat = g.get("saturation", reel["grade"]["saturation"])
    adj["saturation"] = round(float(np.clip(base_sat * (S / max(s, 1e-3)) ** 0.8, 0.6, 1.4)), 2)
    print(f"#{n:<2} {src[:24]:<24} temp {t if t is None else round(t, 3)!s:>7} tint {i if i is None else round(i, 3)!s:>7} "
          f"luma {l:5.0f} sat {s:.3f}  ->  grade: {json.dumps(adj)}")
