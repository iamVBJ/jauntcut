"""Depth slices for a 2.5D camera move on a photo (the "depth3d" clip option).

Usage: python3 scripts/depth_slices.py <depth.png> <outdir> <base> <layers>

From a depth map (white = near), writes <outdir>/<base>.d<k>.png for k = 1..layers-1:
alpha masks of everything nearer than threshold k (soft-edged), at half resolution. The
renderer stacks the photo masked by each, far to near, and pushes nearer layers in more,
so the shot moves like footage from a slider: near things slide past faster.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

depth_path, outdir, base, layers = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
d = Image.open(depth_path).convert("L").resize((540, 960), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2.5))
a = np.asarray(d, np.float32) / 255
# Everything far (sky, distant trees) is one flat background plane: the model's depth
# there is uneven, and slicing it smeared the clouds into streaks. The slices are spaced
# evenly from that plane to the nearest objects.
FAR = 0.15
a = np.where(a < FAR, 0.0, a)
qs = np.linspace(FAR, float(np.quantile(a, 0.995)) * 0.95, layers - 1)
soft = 0.03
for k, th in enumerate(qs, 1):
    m = np.clip((a - th) / soft + 0.5, 0, 1)
    # CSS masks use alpha: white with the mask in the alpha channel.
    rgba = Image.new("RGBA", (540, 960), (255, 255, 255, 0))
    rgba.putalpha(Image.fromarray((m * 255).astype(np.uint8), "L"))
    rgba.save(f"{outdir}/{base}.d{k}.png")
print(f"depth slices {base}: {layers - 1} masks, thresholds {', '.join(f'{t:.2f}' for t in qs)}")
