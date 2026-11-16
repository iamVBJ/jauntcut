"""Beat analysis for a music track.

Usage: python3 scripts/beats.py <music.wav> <out music.json> <original filename>

Writes bpm, the time of the first beat, and a suggested start point (a bar
line after the intro, where the track reaches full energy). The reel cuts on
this grid. Override in reel.ts with music.startAt / music.bpm if needed.
"""
import json
import sys
import wave

import numpy as np

src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]

with wave.open(src, "rb") as w:
    sr = w.getframerate()
    ch = w.getnchannels()
    raw = w.readframes(w.getnframes())
x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
x = x.reshape(-1, ch).mean(axis=1)
duration = len(x) / sr

# Onset envelope: positive spectral flux on a log-magnitude spectrogram.
N, H = 2048, 512
frames = np.lib.stride_tricks.sliding_window_view(x, N)[::H] * np.hanning(N)
mag = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
flux = flux - np.convolve(flux, np.ones(16) / 16, mode="same")
env = np.maximum(flux, 0)
fps = sr / H  # envelope frames per second

# Tempo: autocorrelation, weighted toward a typical 100-130 BPM feel.
ac = np.correlate(env, env, mode="full")[len(env) - 1:]
bpms = np.arange(70, 181, 0.05)
lags = 60 * fps / bpms
score = np.interp(lags, np.arange(len(ac)), ac)
score *= np.exp(-0.5 * (np.log2(bpms / 115) / 0.6) ** 2)
bpm = float(bpms[np.argmax(score)])
if abs(bpm - round(bpm)) < 0.35:
    bpm = float(round(bpm))
period = 60 * fps / bpm

# Phase: offset whose beat grid lands on the most onset energy.
idx = np.arange(len(env))
best, phase = -1.0, 0.0
for off in np.arange(0, period, 0.25):
    pos = np.arange(off, len(env) - 1, period)
    s = np.interp(pos, idx, env).sum()
    if s > best:
        best, phase = s, off
first_beat = phase / fps
spb = 60 / bpm

# Refine the grid's position at ~3 ms resolution against low-frequency hits (kick,
# bass). The coarse grid above sits ~26 ms early on tracks with a clear beat
# (measured on 4 tracks). Only shift when the refinement has a clear peak; tracks
# without a steady kick (bossa, lo-fi) keep the coarse value.
FH = 64
ff = np.lib.stride_tricks.sliding_window_view(x, 1024)[::FH] * np.hanning(1024)
lowmag = np.log1p(100 * np.abs(np.fft.rfft(ff, axis=1)))[:, : int(1300 / (sr / 1024))]
fenv = np.maximum(0, np.diff(lowmag, axis=0)).sum(1)
ft = (np.arange(len(fenv)) + 1) * FH / sr + 512 / sr
span = min(duration, 60.0)
deltas = np.arange(-0.06, 0.0601, 0.003)
grid = np.arange(first_beat, span, spb)
sc = np.array([np.interp(grid + d, ft, fenv).mean() for d in deltas])
best = int(np.argmax(sc))
refined = False
if sc[best] > 1.5 * np.median(sc) and 0 < best < len(deltas) - 1:
    first_beat = max(0.0, first_beat + float(deltas[best]))
    refined = True

# Suggested start: first 4-beat bar line where the next 8 beats are near full energy.
beat_times = np.arange(first_beat, duration - 8 * spb, spb)
def rms(t0, t1):
    seg = x[int(t0 * sr):int(t1 * sr)]
    return float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0.0
windows = [rms(t, t + 8 * spb) for t in beat_times]
target = 0.85 * float(np.percentile(windows, 70)) if windows else 0
start = first_beat
for i, (t, r) in enumerate(zip(beat_times, windows)):
    if i % 4 == 0 and r >= target:
        start = float(t)
        break

result = {
    "file": "music.wav",
    "source": name,
    "bpm": round(bpm, 2),
    "firstBeat": round(first_beat, 3),
    "suggestedStart": round(start, 3),
    "duration": round(duration, 3),
    "refined": refined,
}
with open(out, "w") as f:
    json.dump(result, f, indent=2)
    f.write("\n")
print(f"  music {name}: {result['bpm']} BPM, first beat {result['firstBeat']}s, start {result['suggestedStart']}s of {result['duration']}s")
