"""Labelled contact sheet for scripts/peek.ts: python3 scripts/peek_sheet.py <out.jpg> <fps> <frame images...>
(file names are the frame numbers)."""
import os, sys
from PIL import Image, ImageDraw, ImageFont

out, fps, files = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert("RGB") for f in files]
w, h = ims[0].size
cols = min(len(ims), 6)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 4), rows * (h + 4)), (17, 17, 17))
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except OSError:
    font = ImageFont.load_default()
for k, (f, im) in enumerate(zip(files, ims)):
    x, y = (k % cols) * (w + 4), (k // cols) * (h + 4)
    sheet.paste(im, (x, y))
    frame = int(os.path.basename(f).split(".")[0])
    ImageDraw.Draw(sheet).text((x + 8, y + 6), f"{frame / fps:.2f}s", fill=(255, 220, 0), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
sheet.save(out, quality=88)
print(f"peek {out}: {len(ims)} frames")
