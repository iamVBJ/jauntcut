"""Draws the text-placement review sheet: every sampled hook / closing frame
(text hidden) with the box where the text will sit. Written to
out/qa/<slug>-text.jpg by `npm run layout`. Review it by eye: the box must not
cover the subject (people, architecture, a passing plane) at any moment."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

SAFE_SIDE, W_FRAME = 150, 1080
H_BOX = {"hook": 0.15, "closing": 0.10}
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
except OSError:
    font = ImageFont.load_default()
os.makedirs("out/qa", exist_ok=True)
for s in json.load(open(sys.argv[1])):
    rows = [("hook", s["hook"], s["hookY"])] + ([("closing", s["close"], s["closingY"])] if s["closing"] else [])
    tw, th = 135, 240
    width = max(len(f) for _, f, _ in rows) * tw
    sheet = Image.new("RGB", (width, len(rows) * (th + 20)), (16, 16, 16))
    d = ImageDraw.Draw(sheet)
    for ri, (kind, files, y) in enumerate(rows):
        d.text((4, ri * (th + 20) + 3), f"{kind} at {y * 100:.0f}%", fill="yellow", font=font)
        for i, f in enumerate(files):
            im = Image.open(f).convert("RGB").resize((tw, th))
            dd = ImageDraw.Draw(im)
            x0, x1 = SAFE_SIDE / W_FRAME * tw, tw - SAFE_SIDE / W_FRAME * tw
            dd.rectangle([x0, (y - H_BOX[kind] / 2) * th, x1, (y + H_BOX[kind] / 2) * th], outline=(255, 50, 50), width=2)
            sheet.paste(im, (i * tw, ri * (th + 20) + 18))
    sheet.save(f"out/qa/{s['slug']}-text.jpg", quality=82)
    print(f"text sheet out/qa/{s['slug']}-text.jpg")
