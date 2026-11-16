"""Motion track + subject cutouts for one clip, frame by frame of the output.

Usage: python3 scripts/track.py <video> <times.json> <outdir>
  times.json: {"times": [source seconds of output frame 0, 1, ...], "w": 1080, "h": 1920}

For every source frame the clip shows:
  cut_<k>.png  the frame at WxH, transparent except the moving subject (Apple Vision,
               .cache/bin/subjectmask), to lay back on top of text placed in the scene
  background motion: how far the scene has moved since the first frame, in output
               pixels (masked phase correlation: the subject is excluded, so a kart
               passing close doesn't drag the track)
Writes <outdir>/track.json: {"frames": [{"c": k, "dx": .., "dy": .., "box": [x0, y0, x1, y1] | null}]}
(box = the subject's bounding box in output pixels). Text attached to the scene moves
by (dx, dy); the subject cutout goes on top of it.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image

video, times_path, out = sys.argv[1:4]
spec = json.load(open(times_path))
times, W, H = spec["times"], spec["w"], spec["h"]
# Band of the frame to track (fractions of height): the ground around scene text, so the
# letters follow the surface they stand on, not the distant fence or sky.
R0, R1 = spec.get("region", [0, 1])
os.makedirs(out, exist_ok=True)

fps_s = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
                        "-of", "csv=p=0", video], capture_output=True, text=True, check=True).stdout.strip()
num, den = (int(v) for v in fps_s.split("/"))
fps = num / den

# 1. The source frames the output shows (nearest frame to each output frame's time).
a = max(0.0, min(times) - 1 / fps)
idx = [int(round((t - a) * fps)) for t in times]
need = sorted(set(idx))
src = os.path.join(out, "src")
os.makedirs(src, exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.4f}", "-i", video, "-frames:v", str(need[-1] + 1),
                os.path.join(src, "%05d.png")], check=True)
have = {k for k in need if os.path.exists(os.path.join(src, f"{k + 1:05d}.png"))}
missing = [k for k in need if k not in have]
if missing:
    sys.exit(f"track: source frames missing {missing[:5]} (window runs past the video?)")

# 2. Subject cutouts at output size.
pairs = []
for k in need:
    dst = os.path.join(out, f"cut_{k}.png")
    if not os.path.exists(dst):
        pairs += [os.path.join(src, f"{k + 1:05d}.png"), dst]
for i in range(0, len(pairs), 40):
    subprocess.run([".cache/bin/subjectmask", "--cutout", str(W), str(H), *pairs[i:i + 40]], check=True)

# 2b. Keep only real subjects: Vision sometimes returns a background strip (a tyre wall
# across the whole frame) when no kart is in view. Drop connected pieces spanning nearly
# the full width; they are scenery, not something passing in front.
CW, CH = 135, 240

def components(m):
    lab = np.zeros(m.shape, np.int32)
    n = 0
    for y0, x0 in zip(*np.nonzero(m)):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and m[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
    return lab, n

dropped = 0
for k in need:
    path = os.path.join(out, f"cut_{k}.png")
    im = Image.open(path)
    a = np.asarray(im.getchannel("A"))
    if not a.any():
        continue
    small = np.asarray(Image.fromarray(a).resize((CW, CH), Image.NEAREST)) > 128
    lab, n = components(small)
    bad = np.zeros_like(small)
    for c in range(1, n + 1):
        xs = np.nonzero((lab == c).any(0))[0]
        if xs.max() - xs.min() + 1 > 0.85 * CW:
            bad |= lab == c
    if bad.any():
        dropped += 1
        big = np.asarray(Image.fromarray((bad * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)) > 0
        rgba = np.asarray(im.convert("RGBA")).copy()
        rgba[..., 3][big] = 0
        Image.fromarray(rgba).save(path)
if dropped:
    print(f"track: dropped full-width background pieces in {dropped} frames")

# 3. Background motion between consecutive source frames, subject masked out.
# A narrow band is tracked at higher resolution (fine asphalt texture).
SW = 270 if (R1 - R0) > 0.6 else 540
FH = int(round(SW * 16 / 9))
y0, y1 = int(R0 * FH), int(R1 * FH)
SH = y1 - y0
win = np.outer(np.hanning(SH), np.hanning(SW))

def gray(k):
    im = Image.open(os.path.join(src, f"{k + 1:05d}.png")).convert("L").resize((SW, FH), Image.BILINEAR)
    return np.asarray(im, np.float32)[y0:y1]

def alpha(k):
    im = Image.open(os.path.join(out, f"cut_{k}.png")).getchannel("A").resize((SW, FH), Image.BILINEAR)
    m = np.asarray(im, np.float32)[y0:y1] / 255 > 0.1
    # grow the mask a little so the subject's edge doesn't count either
    for _ in range(6):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m

def shift(p, q, mp, mq):
    keep = ~(mp | mq)
    fill = lambda img: np.where(keep, img, img[keep].mean() if keep.any() else img.mean())
    A = np.fft.fft2((fill(p) - p[keep].mean()) * win)
    B = np.fft.fft2((fill(q) - q[keep].mean()) * win)
    R = B * A.conj()
    R /= np.abs(R) + 1e-9
    r = np.fft.ifft2(R).real
    y, x = np.unravel_index(np.argmax(r), r.shape)
    # sub-pixel: parabola through the peak and its neighbours
    def sub(c, l, rr):
        d = l - 2 * c + rr
        return 0.0 if d == 0 else 0.5 * (l - rr) / d
    dx = x + sub(r[y, x], r[y, (x - 1) % SW], r[y, (x + 1) % SW])
    dy = y + sub(r[y, x], r[(y - 1) % SH, x], r[(y + 1) % SH, x])
    if dx > SW / 2: dx -= SW
    if dy > SH / 2: dy -= SH
    return dx, dy

pos = {need[0]: (0.0, 0.0)}
prev = need[0]
gp, mp = gray(prev), alpha(prev)
for k in need[1:]:
    gq, mq = gray(k), alpha(k)
    dx, dy = shift(gp, gq, mp, mq)
    px, py = pos[prev]
    pos[k] = (px + dx, py + dy)
    prev, gp, mp = k, gq, mq

# 4. Per output frame.
sx, sy = W / SW, H / FH
frames = []
boxes = {}
for k in need:
    al = np.asarray(Image.open(os.path.join(out, f"cut_{k}.png")).getchannel("A")) > 128
    ys, xs = np.nonzero(al)
    boxes[k] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) > 40 else None
for k in idx:
    dx, dy = pos[k]
    frames.append({"c": k, "dx": round(dx * sx, 2), "dy": round(dy * sy, 2), "box": boxes[k]})
json.dump({"frames": frames}, open(os.path.join(out, "track.json"), "w"))
# The extracted source frames are only needed while tracking.
for f in os.listdir(src):
    os.remove(os.path.join(src, f))
os.rmdir(src)
moved = frames[-1]["dx"], frames[-1]["dy"]
print(f"track {os.path.basename(out)}: {len(frames)} frames, {len(need)} source frames, "
      f"subject in {sum(1 for k in need if boxes[k])}, scene moved {moved[0]:.0f},{moved[1]:.0f} px")
