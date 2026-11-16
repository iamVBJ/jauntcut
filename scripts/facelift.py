"""Brightens only the face in a video clip (clip.faceLift, run by `npm run derive`).

Faces are found with Vision (scripts/faces.swift) on every 6th frame, gaps filled from
the nearest detection and the track smoothed. Each frame is then lifted inside a soft
ellipse around the face, weighted to skin colour (the red suit, black helmet and sky
around it are left as they are). The lift is a gamma on luminance with the colour
ratios kept, so the skin gets fairer without washing out or changing hue.

Usage: facelift.py <in.mp4> <out.mp4> <amount>   (amount 0.5 = gamma 1/1.5 on the face)
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageFilter

src, dst, amount = sys.argv[1], sys.argv[2], float(sys.argv[3])
FACES = ".cache/bin/faces"
STEP = 6

probe = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", src]))["streams"][0]
W, H, N = probe["width"], probe["height"], int(probe["nb_read_frames"])
rate = probe["r_frame_rate"]

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", f"select='not(mod(n\\,{STEP}))',scale=-2:720",
                    "-fps_mode", "passthrough", f"{tmp}/%05d.png"], check=True)
    found = json.loads(subprocess.check_output([FACES, tmp]))
# Detection k is source frame (k - 1) * STEP; keep the most confident face.
keys = sorted(found)
det = {}
for k in keys:
    if found[k]:
        det[(int(k[:5]) - 1) * STEP] = max(found[k], key=lambda b: b[4])[:4]
if not det:
    sys.exit(f"facelift: no face found in {src}")
at = np.array(sorted(det))
boxes = np.array([det[a] for a in at])
frames = np.arange(N)
# Linear between detections, held at the ends; then a light moving average.
track = np.stack([np.interp(frames, at, boxes[:, j]) for j in range(4)], axis=1)
kern = np.ones(9) / 9
track = np.stack([np.convolve(np.pad(track[:, j], 4, mode="edge"), kern, mode="valid") for j in range(4)], axis=1)
print(f"facelift: face found in {len(det)}/{len(keys)} sampled frames, {N} frames lifted")

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
gamma = 1 / (1 + amount)

dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                        "-r", rate, "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-g", "30",
                        "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
                        "-colorspace", "bt709", dst], stdin=subprocess.PIPE)
i = 0
while True:
    buf = dec.stdout.read(W * H * 3)
    if len(buf) < W * H * 3:
        break
    img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32) / 255
    x, y, w, h = track[min(i, N - 1)]
    i += 1
    # Ellipse wider than Vision's box (it stops at the brows and the jaw, and in profile
    # short of the ear); the skin weight keeps it off the helmet, glasses and suit.
    cx, cy, rx, ry = (x + w / 2) * W, (y + h * 0.55) * H, w * 1.0 * W, h * 0.85 * H
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    ell = np.clip((1.25 - d) / 0.5, 0, 1)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    # Skin: green a good share of red (the suit is pure red), not black, not sky.
    ratio = g / np.maximum(r, 1e-3)
    skin = np.clip((ratio - 0.42) / 0.15, 0, 1) * np.clip((r - 0.04) / 0.06, 0, 1) * np.clip((r - b) / 0.06, 0, 1)
    m = Image.fromarray((ell * skin * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(H / 160))
    m = np.asarray(m, np.float32)[..., None] / 255
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    gain = (np.power(np.maximum(lum, 1e-4), gamma) / np.maximum(lum, 1e-4))[..., None]
    out = np.clip(img * (1 + (gain - 1) * m), 0, 1)
    enc.stdin.write((out * 255 + 0.5).astype(np.uint8).tobytes())
enc.stdin.close()
dec.stdout.close()
if enc.wait() or dec.wait() or i != N:
    sys.exit(f"facelift: ffmpeg failed or frame count changed ({i} written, {N} in source)")
