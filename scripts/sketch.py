"""Pencil sketch of a photo, for the sketch transition (the shot is drawn, then painted).

Usage: python3 scripts/sketch.py <photo> <out.png>

Writes a PNG the same shape as the photo (1440 px wide): graphite-coloured lines whose
alpha is the line strength, transparent elsewhere, so the renderer can lay it over paper
or over the photo and draw it on strongest lines first. Classic "colour dodge" pencil
drawing: grey / (1 - blurred inverse) keeps edges and soft shading, flattens flat areas.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1:3]
im = Image.open(src).convert("L")
W = 1440
im = im.resize((W, round(W * im.height / im.width)), Image.LANCZOS)
g = np.asarray(im, np.float32)
inv = Image.fromarray((255 - g).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7))
blur = np.asarray(inv, np.float32)
dodge = np.clip(g * 255.0 / np.maximum(1.0, 255.0 - blur), 0, 255)
dark = 255.0 - dodge                      # 0 = paper, high = pencil
dark = np.clip((dark - 10) * 1.9, 0, 255)  # drop faint noise, strengthen lines
dark = 255.0 * (dark / 255.0) ** 0.85
alpha = Image.fromarray(dark.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
rgba = Image.new("RGBA", alpha.size, (46, 42, 38, 0))  # warm graphite
rgba.putalpha(alpha)
rgba.save(out)
a = np.asarray(alpha, np.float32) / 255
print(f"sketch {out} {rgba.width}x{rgba.height}, line cover {100 * (a > 0.25).mean():.1f}%")
