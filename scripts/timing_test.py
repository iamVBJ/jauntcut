"""Exact timing test for video clips (speed, ramps, trims).

Usage: npm run timing-test
Makes a 60 fps test video whose frames show their own frame number as 12
black/white bars, edits it through the real Reel component with a normal clip,
a 1.5x clip, a ramp, a 0.5x clip, a reversed clip and a smooth (interpolated)
0.5x clip, renders it (running the derive step first), reads the bars back from
every output frame and compares with the frame the edit asked for. For smooth
slow motion only the original frames are checked (the in-betweens are invented). Exits 1 on any
error over 1 source frame. Cleans up its temporary topic afterwards.
"""
import json, os, shutil, subprocess, sys
import numpy as np

SLUG, FPS, N, BITS = "timing-test", 60, 1200, 12
W, H = 1080, 1920
topic, pub = f"topics/{SLUG}", f"public/{SLUG}"

def bars(i):
    img = np.full((H, W), 128, np.uint8)
    bw = W // (BITS + 4)
    for b in range(BITS):
        x0 = (b + 2) * bw
        img[H // 2 - 300:H // 2 + 300, x0:x0 + bw] = 255 if (i >> (BITS - 1 - b)) & 1 else 0
    return img

def decode(gray):  # gray: H x W
    bw = W // (BITS + 4)
    row = gray[H // 2 - 100:H // 2 + 100].mean(0)
    v = 0
    for b in range(BITS):
        x0 = (b + 2) * bw
        v = (v << 1) | int(row[x0 + bw // 4:x0 + 3 * bw // 4].mean() > 128)
    return v

try:
    os.makedirs(f"{topic}/raw", exist_ok=True)
    os.makedirs(pub, exist_ok=True)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "10", "-g", "30", "-pix_fmt", "yuv420p",
                            f"{pub}/bars.mp4"], stdin=subprocess.PIPE)
    for i in range(N):
        enc.stdin.write(bars(i).tobytes())
    enc.stdin.close(); enc.wait()
    open(f"{topic}/raw/bars.mov", "w").close()  # name only; prepared file is public/<slug>/bars.mp4
    still = '{ x: 0.5, y: 0.5 }'
    clips = [
        f'{{ src: "bars.mov", beats: 2, startAt: 2.0, focal: {still}, motion: "still" }}',
        f'{{ src: "bars.mov", beats: 2, startAt: 5.0, speed: 1.5, focal: {still}, motion: "still" }}',
        f'{{ src: "bars.mov", beats: 4, startAt: 8.0, ramp: {{ atBeat: 2, speed: 2 }}, focal: {still}, motion: "still" }}',
        f'{{ src: "bars.mov", beats: 2, startAt: 15.0, speed: 0.5, focal: {still}, motion: "still" }}',
        f'{{ src: "bars.mov", beats: 2, startAt: 16.0, reverse: true, focal: {still}, motion: "still" }}',
        f'{{ src: "bars.mov", beats: 2, startAt: 3.0, speed: 0.5, smooth: true, focal: {still}, motion: "still" }}',
    ]
    with open(f"{topic}/reel.ts", "w") as f:
        f.write('import type { ReelInput } from "../../src/schema";\n'
                f'export const reel: ReelInput = {{ slug: "{SLUG}", hook: " ", place: " ", hookBeats: 1,\n'
                '  grade: { warmth: 0, contrast: 1, saturation: 1, grain: 0, vignette: 0 },\n'
                f'  clips: [{", ".join(clips)}] }};\n')
    subprocess.run(["npx", "tsx", "scripts/topics.ts"], check=True, capture_output=True)
    out = f"{pub}/render.mp4"
    subprocess.run(["npx", "tsx", "scripts/derive.ts", SLUG], check=True, capture_output=True)
    subprocess.run(["npx", "remotion", "render", SLUG, out, "--crf=10"], check=True, capture_output=True)
    plan = json.loads(subprocess.run(["npx", "tsx", "scripts/plan.ts", SLUG], capture_output=True, text=True, check=True).stdout)
    # Expected source frame for EVERY output frame, from the plan helper's maths.
    exp = json.loads(subprocess.run(["npx", "tsx", "-e", f'''
      import {{ reelSchema }} from "./src/schema"; import {{ topics }} from "./src/topics.generated";
      import {{ FPS, beatFrame, clipStarts }} from "./src/lib";
      const r = reelSchema.parse(topics.find((t) => t.slug === "{SLUG}")); const st = clipStarts(r); const o: [number, number, number][] = [];
      r.clips.forEach((c, i) => {{ const {{ from, frames }} = st[i];
        const at = c.ramp ? Math.min(beatFrame(r, c.ramp.atBeat), frames) : frames;
        const n = Math.round(frames * c.speed);
        for (let f = 2; f < frames - 2; f++) {{
          const s = f <= at ? f * c.speed : at * c.speed + (f - at) * (c.ramp?.speed ?? c.speed);
          if (c.smooth && Math.abs(s - Math.round(s)) > 1e-6) continue; // interpolated frame
          o.push([from + f, c.reverse ? c.startAt * FPS + n - 1 - s : c.startAt * FPS + s, i + 1]); }} }});
      console.log(JSON.stringify(o));'''], capture_output=True, text=True, check=True).stdout)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W)
    worst = {}
    for of, want, clip in exp:
        got = decode(frames[of])
        err = got - want
        if clip not in worst or abs(err) > abs(worst[clip][0]):
            worst[clip] = (err, of, want, got)
    bad = 0
    names = {1: "1x", 2: "1.5x", 3: "ramp 1x->2x", 4: "0.5x", 5: "reverse", 6: "smooth 0.5x"}
    for clip, (err, of, want, got) in sorted(worst.items()):
        ok = abs(err) <= 1.01
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} clip {clip} {names[clip]:<12} worst error {err:+.1f} source frames "
              f"(output frame {of}: wanted {want:.1f}, showed {got})")
    print(f"\n{len(exp)} frames checked, {bad} clips off by more than 1 frame")
    code = 1 if bad else 0
finally:
    shutil.rmtree(topic, ignore_errors=True)
    shutil.rmtree(pub, ignore_errors=True)
    subprocess.run(["npx", "tsx", "scripts/topics.ts"], capture_output=True)
sys.exit(code)
