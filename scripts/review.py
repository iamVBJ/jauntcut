"""Frame strips and quality scores for every clip in a topic, to pick moments fast.

Usage: npm run review <slug>      (run `npm run media <slug>` first)

Writes review/<slug>/:
  overview.jpg        sharpest frame of every clip, labelled, one sheet
  strips/<clip>.jpg   a frame every 0.5 s with its time; red = blurry,
                      orange = fast motion (shake or whip), blue = dark
  report.json         per-frame scores and the best windows per clip
and prints the usable windows per clip, e.g. "IMG_2549  1.5-4.0s".

Scores (per frame, on a 270 px wide copy so clips compare fairly):
  sharp   Laplacian variance of the sharpest areas (90th percentile of a 6x10
          tile grid), so an in-focus subject on a soft background counts as sharp
  move    camera movement from the previous frame, in % of frame width per
          second (phase correlation). ~0 = locked off, 10-60 = smooth pan,
          80+ = whip or shake. Moving water or people don't count.
  conf    how well frames line up (0-1). Low on walking shots, where the view
          changes perspective rather than sliding; those are still usable.
  bright  mean brightness, 0-255
  temp/tint  white balance of neutral pixels (+temp warmer, +tint greener), for
          the colour-match check between neighbouring clips
  active  how much the picture changes per 0.5 s (camera OR subject: fish,
          people, water), mean abs change of a blurred 1/4-size copy, 0-255.
          Low = a dead hold; used by the flow checks.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 2  # frames sampled per second
W = 270  # analysis and thumbnail width
BLURRY = 0.45  # sharp below this fraction of the clip's 90th percentile
BLURRY_ABS = 300  # or below this at all: catches clips that are soft throughout
MOTION_FAST = 80  # camera moving faster than this (% width per second) = whip/shake
DARK = 40  # mean brightness below this
MIN_WINDOW = 1.0  # seconds; shorter clean stretches aren't reported
# Internal cuts (pre-edited footage): a candidate at 2 fps with a big colour change,
# confirmed only if the change happens between two consecutive frames. Calibrated:
# a real cut jumps 0.52 in one frame (19x typical); the fastest pans peak at 0.12 (2x).
CUT_CANDIDATE, CUT_JUMP, CUT_RATIO = 0.2, 0.3, 6.0

slug = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: npm run review <slug>")
src_dir = os.path.join("public", slug)
if not os.path.isdir(src_dir):
    sys.exit(f"public/{slug} not found: run npm run media {slug} first")
out_dir = os.path.join("review", slug)
os.makedirs(os.path.join(out_dir, "strips"), exist_ok=True)

try:
    FONT = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
    FONT_BIG = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
except OSError:
    FONT = FONT_BIG = ImageFont.load_default()


def frames_of(path):
    """RGB frames at FPS for a video, or the single image for a photo."""
    if path.endswith(".jpg"):
        im = Image.open(path).convert("RGB")
        im = im.resize((W, round(im.height * W / im.width)))
        return [np.asarray(im)], [0.0]
    h = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout.strip().splitlines()[0].split(",")
    # (first line only: GoPro files list a stream group after the stream)
    H = round(int(h[1]) * W / int(h[0]) / 2) * 2
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    n = len(raw) // (W * H * 3)
    arr = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3)
    return list(arr), [i / FPS for i in range(n)]


def shift(a, b, win):
    """Global translation between two gray frames via phase correlation."""
    A = np.fft.fft2((a - a.mean()) * win)
    B = np.fft.fft2((b - b.mean()) * win)
    R = A * np.conj(B)
    r = np.abs(np.fft.ifft2(R / (np.abs(R) + 1e-9)))
    y, x = np.unravel_index(r.argmax(), r.shape)
    h, w = a.shape
    y = y - h if y > h / 2 else y
    x = x - w if x > w / 2 else x
    return float(np.hypot(x, y) / w * 100 * FPS), float(r.max())


def scores(frames):
    out, prev, prev_small = [], None, None
    h, w = frames[0].shape[:2]
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    for f in frames:
        g = f.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
        lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
        lh, lw = lap.shape
        tiles = [lap[y * lh // 10:(y + 1) * lh // 10, x * lw // 6:(x + 1) * lw // 6].var()
                 for y in range(10) for x in range(6)]
        move, conf = shift(prev, g, win) if prev is not None else (0.0, 1.0)
        small = g[: h // 4 * 4, : w // 4 * 4].reshape(h // 4, 4, w // 4, 4).mean((1, 3))
        active = float(np.abs(small - prev_small).mean()) if prev_small is not None else 0.0
        px = f.reshape(-1, 3).astype(np.float32)
        mx, mn = px.max(1), px.min(1)
        neutral = px[(mx - mn < 0.25 * (mx + 1)) & (mx > 60) & (mx < 235)]
        if len(neutral) > 200:
            r_, g_, b_ = neutral.mean(0)
            tot = r_ + g_ + b_
            temp, tint = (r_ - b_) / tot, (g_ - (r_ + b_) / 2) / tot
        else:
            temp, tint = 0.0, 0.0
        out.append({"sharp": float(np.percentile(tiles, 90)), "move": move, "conf": conf,
                    "bright": float(g.mean()), "active": active, "temp": float(temp), "tint": float(tint)})
        prev, prev_small = g, small
    if len(out) > 1:
        # first frame has no predecessor
        out[0]["move"], out[0]["conf"], out[0]["active"] = out[1]["move"], out[1]["conf"], out[1]["active"]
    return out


def flags(s, ref):
    f = []
    if s["sharp"] < BLURRY * ref or s["sharp"] < BLURRY_ABS:
        f.append("blurry")
    if s["move"] > MOTION_FAST:
        f.append("fast")
    if s["bright"] < DARK:
        f.append("dark")
    return f


def windows(times, sc, fl):
    """Contiguous stretches with no flags, at least MIN_WINDOW long, best first."""
    runs, start = [], None
    for i, f in enumerate(fl + [["end"]]):
        if not f and start is None:
            start = i
        elif f and start is not None:
            end_t = times[i - 1] + 1 / FPS
            if end_t - times[start] >= MIN_WINDOW:
                runs.append({"from": times[start], "to": round(end_t, 2),
                             "sharp": round(float(np.mean([s["sharp"] for s in sc[start:i]])), 1)})
            start = None
    return sorted(runs, key=lambda r: -r["sharp"])


COLORS = {"blurry": (220, 50, 50), "fast": (240, 150, 30), "dark": (60, 110, 230), "cut": (200, 60, 220)}


def strip(name, frames, times, sc, fl):
    cols = 8
    th = frames[0].shape[0]
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (W + 6), rows * (th + 30) + 36), (16, 16, 16))
    d = ImageDraw.Draw(sheet)
    d.text((6, 8), f"{name}   red=blurry  orange=whip/shake  blue=dark   move = camera speed, % width/s", fill="white", font=FONT_BIG)
    for i, (f, t, s, fg) in enumerate(zip(frames, times, sc, fl)):
        x, y = (i % cols) * (W + 6), 36 + (i // cols) * (th + 30)
        if fg:
            d.rectangle([x, y, x + W + 5, y + th + 29], fill=COLORS[fg[0]])
        sheet.paste(Image.fromarray(f), (x + 3, y + 27))
        d.text((x + 6, y + 4), f"{t:.1f}s  sharp {s['sharp']:.0f}  move {s['move']:.0f}%" + (" walk" if s["conf"] < 0.05 else ""), fill="white", font=FONT)
    sheet.save(os.path.join(out_dir, "strips", f"{name}.jpg"), quality=82)


def hist(f):
    q = (f // 32).astype(np.int32)
    h = np.bincount((q[..., 0] * 64 + q[..., 1] * 8 + q[..., 2]).ravel(), minlength=512).astype(float)
    return h / h.sum()


def bdist(a, b):
    return float(np.sqrt(max(0.0, 1 - np.sum(np.sqrt(a * b)))))


def internal_cuts(path, frames, times):
    """Exact times of hard cuts inside a file (footage edited elsewhere)."""
    hs = [hist(f) for f in frames]
    cuts = []
    for i in range(1, len(hs)):
        if bdist(hs[i - 1], hs[i]) < CUT_CANDIDATE:
            continue
        t0 = max(0.0, times[i - 1] - 0.05)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{1 / FPS + 0.1:.3f}", "-i", path,
                              "-vf", "scale=135:240", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        fr = np.frombuffer(raw, np.uint8).reshape(-1, 240, 135, 3)
        if len(fr) < 3:
            continue
        hh = [hist(x) for x in fr]
        d = np.array([bdist(hh[j - 1], hh[j]) for j in range(1, len(hh))])
        j = int(d.argmax())
        if d[j] > CUT_JUMP and d[j] > CUT_RATIO * (np.median(d) + 1e-3):
            fps = len(fr) / (1 / FPS + 0.1)
            cuts.append(round(t0 + (j + 1) / fps, 2))
    return cuts


TEXT_HELPER = ".cache/textdetect"


def overlay_text(path, duration, active_median):
    """Burned-in captions/watermarks: text that stays at the same place on screen
    while the rest of the picture changes (activity), which a sign in the scene
    can't do. (Camera-shift isn't used: a static caption fools it into "still".)"""
    if not os.path.exists(TEXT_HELPER) or os.path.getmtime(TEXT_HELPER) < os.path.getmtime("scripts/textdetect.swift"):
        subprocess.run(["swiftc", "-O", "scripts/textdetect.swift", "-o", TEXT_HELPER], check=True)
    tmp = os.path.join(".cache", "review-text")
    os.makedirs(tmp, exist_ok=True)
    shots = []
    for k, p in enumerate((0.2, 0.5, 0.8)):
        o = os.path.join(tmp, f"{os.path.basename(path)}-{k}.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{duration * p:.2f}", "-i", path, "-frames:v", "1",
                        "-vf", "scale=540:-2", o], check=True)
        shots.append(o)
    res = [json.loads(l) for l in subprocess.run([TEXT_HELPER, *shots], capture_output=True, text=True).stdout.strip().splitlines()]
    found = []
    for t in res[0].get("text", []):
        if t["conf"] < 0.3 or len(t["s"].strip()) < 3:
            continue
        cx, cy = t["box"][0] + t["box"][2] / 2, t["box"][1] + t["box"][3] / 2
        same = [u for r in res[1:] for u in r.get("text", [])
                if abs(u["box"][0] + u["box"][2] / 2 - cx) < 0.03 and abs(u["box"][1] + u["box"][3] / 2 - cy) < 0.03]
        if len(same) >= 1:
            found.append({"text": t["s"], "box": t["box"], "kind": "overlay" if active_median > 15 else "static"})
    return found


report, overview = {}, []
files = sorted(f for f in os.listdir(src_dir) if f.endswith((".mp4", ".jpg")))
if not files:
    sys.exit(f"no prepared media in public/{slug}")
for fname in files:
    name = os.path.splitext(fname)[0]
    frames, times = frames_of(os.path.join(src_dir, fname))
    if not frames:
        print(f"FAIL {fname}: no frames decoded")
        continue
    sc = scores(frames)
    ref = float(np.percentile([s["sharp"] for s in sc], 90))
    fl = [flags(s, ref) for s in sc]
    is_vid = fname.endswith(".mp4")
    cuts = internal_cuts(os.path.join(src_dir, fname), frames, times) if is_vid and len(frames) > 1 else []
    for c in cuts:  # a clip must not span a cut inside the file
        for k, t in enumerate(times):
            if abs(t - c) <= 0.25 and "cut" not in fl[k]:
                fl[k] = fl[k] + ["cut"]
    texts = []
    if is_vid and len(frames) > 2:
        texts = overlay_text(os.path.join(src_dir, fname), times[-1] + 1 / FPS, float(np.median([x["active"] for x in sc])))
    win = windows(times, sc, fl) if len(frames) > 1 else []
    best = int(np.argmax([s["sharp"] if not f else -1 for s, f in zip(sc, fl)]))
    is_video = fname.endswith(".mp4")
    report[name] = {
        "file": fname, "video": is_video, "seconds": round(times[-1] + 1 / FPS, 2) if is_video else 0,
        "windows": win, "best": times[best], "cuts": cuts, "text": texts,
        "frames": [{"t": t, **{k: round(v, 3 if k in ("temp", "tint") else 2 if k == "conf" else 1) for k, v in s.items()}, "flags": f}
                   for t, s, f in zip(times, sc, fl)],
    }
    if is_video:
        strip(name, frames, times, sc, fl)
    overview.append((name, frames[best], times[best], is_video, win, fl[best]))
    if is_video:
        w = ", ".join(f"{r['from']:.1f}-{r['to']:.1f}s" for r in win[:3]) or "no clean stretch >= 1s"
        extra = (f"  internal cuts at {', '.join(f'{c}s' for c in cuts)}" if cuts else "") + "".join(
            f"  {'BURNED-IN TEXT' if t['kind'] == 'overlay' else 'text (sign or caption?)'} \"{t['text']}\"" for t in texts)
        print(f"{name:<12} video {report[name]['seconds']:>5.1f}s  best {times[best]:.1f}s  clean: {w}{extra}")
    else:
        print(f"{name:<12} photo          {'  '.join(fl[0]) or 'ok'}")

# Overview: best frame per clip.
cols = 6
th = overview[0][1].shape[0]
rows = (len(overview) + cols - 1) // cols
sheet = Image.new("RGB", (cols * W, rows * (th + 56)), (16, 16, 16))
d = ImageDraw.Draw(sheet)
for i, (name, f, t, vid, win, fg) in enumerate(overview):
    x, y = (i % cols) * W, (i // cols) * (th + 56)
    sheet.paste(Image.fromarray(f).resize((W, th)), (x, y + 52))
    d.text((x + 4, y + 4), name, fill="yellow", font=FONT_BIG)
    sub = (f"video best {t:.1f}s, {len(win)} clean" if vid else "photo") + (f"  {fg[0]}" if fg else "")
    d.text((x + 4, y + 28), sub, fill="white", font=FONT)
sheet.save(os.path.join(out_dir, "overview.jpg"), quality=85)

with open(os.path.join(out_dir, "report.json"), "w") as fh:
    json.dump(report, fh, indent=1)
print(f"\n{len(report)} clips -> {out_dir}/overview.jpg, strips/, report.json")
