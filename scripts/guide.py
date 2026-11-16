"""Turns a screen recording of a trending reel (or any audio/video) into a beat
guide for cutting.

Usage: python3 scripts/guide.py <recording> <out.wav> [--start SECONDS]

Where the snippet starts: the recording must begin with silence and then the
sound starts (start screen recording, then press play on the sound in Instagram's
editor). The first sound after the silence is the snippet start: tested within
~1 ms on four tracks after correcting the detector's fixed 11 ms lead.
A recording that joins mid-loop is refused: finding the restart from the music
alone was tested and was wrong by up to 8 s with high confidence, so it isn't
guessed. Use --start SECONDS if you know it. The loop length (how long the
snippet is) is still measured from the repetition, accurate to ~10 ms.
Then it writes exactly one loop, starting where Instagram starts the snippet, and
prints JSON: {"loop": seconds|null, "start": seconds, "confidence": 0-1}.
With --start the start is taken as given. A recording with no repetition is used
from its beginning (e.g. already trimmed).
"""
import json, subprocess, sys
import numpy as np

src, out = sys.argv[1], sys.argv[2]
manual = float(sys.argv[sys.argv.index("--start") + 1]) if "--start" in sys.argv else None

SR, HOP, N = 22050, 512, 2048
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                     capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32)
if len(x) < SR * 3:
    sys.exit("recording too short (need a few seconds of audio)")
fps = SR / HOP

frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP] * np.hanning(N)
spec = np.abs(np.fft.rfft(frames, axis=1))
# 24 log-spaced bands, log energy, unit-normalised per frame.
edges = np.unique(np.geomspace(2, spec.shape[1] - 1, 25).astype(int))
bands = np.stack([spec[:, a:b].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1)
F = np.log1p(bands)
F = F - F.mean(1, keepdims=True)
F /= np.linalg.norm(F, axis=1, keepdims=True) + 1e-9

# Onset envelope (positive spectral flux) for the beat grid.
mag = np.log1p(100 * spec)
env = np.maximum(0, np.diff(mag, axis=0)).sum(1)
env = np.maximum(env - np.convolve(env, np.ones(16) / 16, "same"), 0)
env = np.concatenate([[0], env])

def tempo_period(e):
    ac = np.correlate(e, e, "full")[len(e) - 1:]
    bpms = np.arange(70, 181, 0.05)
    lags = 60 * fps / bpms
    score = np.interp(lags, np.arange(len(ac)), ac) * np.exp(-0.5 * (np.log2(bpms / 115) / 0.6) ** 2)
    return 60 * fps / bpms[np.argmax(score)]

# 1. Loop length.
loop = None
n = len(F)
best_sim, best_lag = 0.0, None
sims = {}
for lag in range(int(4 * fps), int(min(95 * fps, n * 0.6))):
    s = float(np.mean(np.sum(F[:-lag] * F[lag:], 1)))
    sims[lag] = s
    if s > best_sim:
        best_sim, best_lag = s, lag
if best_lag and best_sim > 0.9:
    # Prefer the shortest lag that repeats about as well (avoid picking 2x the loop).
    cands = [l for l, s in sims.items() if s >= best_sim - 0.02]
    lag = min(cands)
    # refine to the local maximum around it
    lo, hi = max(min(sims), lag - 3), min(max(sims), lag + 3)
    lag = max(range(lo, hi + 1), key=lambda l: sims[l])
    loop = lag / fps

# 2. Snippet start.
rms = np.sqrt(np.convolve(x ** 2, np.ones(512) / 512, "same"))
loud = rms > 10 ** (-40 / 20)
lead = int(np.argmax(loud)) / SR if loud.any() else 0.0
if manual is not None:
    method, start = "manual", manual
elif lead >= 0.3:
    # The centred RMS window fires ~11 ms before the true onset (measured); correct it.
    method, start = "silence", lead + 0.011
else:
    print(json.dumps({"error": "no silence before the sound: can't tell where the snippet starts",
                      "loop": round(loop, 3) if loop else None,
                      "fix": "screen-record again, starting the recording BEFORE pressing play on the sound; or pass --start SECONDS"}))
    sys.exit(2)

dur = loop if loop else len(x) / SR - start
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.4f}", "-t", f"{dur:.4f}", "-i", src, "-vn",
                "-ac", "2", "-ar", "48000", out], check=True)
print(json.dumps({"loop": round(loop, 3) if loop else None, "start": round(start, 3), "method": method,
                  "duration": round(dur, 3)}))
