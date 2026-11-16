"""Quality gate for a reel. Exits 1 if anything fails.

Usage: npm run qa <slug> [--pre | --post]
  --pre   before rendering: repeated scenes, text over faces/busy areas, colour jumps
          at cuts, clipped highlights / crushed shadows, skin tones
  --post  after rendering:  black/frozen frames, audio, Instagram copy spec,
          and a cut sheet (out/qa/<slug>-cuts.jpg) for a human continuity pass
  (default runs both)

Thresholds are calibrated on this project's footage (see comments).
"""
import json, os, re, subprocess, sys, itertools
import numpy as np
from PIL import Image, ImageDraw, ImageFont

slug = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else sys.exit("usage: npm run qa <slug> [--pre|--post]")
mode = next((a for a in sys.argv[2:] if a in ("--pre", "--post")), "--both")

# Vision feature-print distance between two shots. Measured on these reels:
# same scene shown twice 0.21-0.42; different shots 0.49+.
REPEAT_FAIL, REPEAT_WARN = 0.45, 0.55
TEXT_BUSY_WARN = 0.40   # layout cost: worst-moment importance under the text; faces add 4x
TEXT_FACE_FAIL = 1.0    # cost this high only happens with a face under the text
LUFS_RANGE = (-16.0, -10.0)  # Instagram normalises around -14 LUFS
PEAK_MAX = -1.0         # dBFS on the upload copy
IG_MAX_MBPS = 20.0
# Colour match across a cut (neutral-pixel white balance of last frame out vs first
# frame in). On the existing reels: temp jumps median 0.011, p90 0.036, max 0.064
# (pool -> warm facade, a real scene change). Warnings only.
TEMP_JUMP, TINT_JUMP, LUMA_JUMP = 0.05, 0.03, 1.8
# Exposure. Small clipped specular highlights are normal; a large burnt-out area has no
# detail to recover and reads as a fault (sky, white walls). Same for crushed blacks.
# Measured on the five reels: clipped highlights median 0.6%, sources 0-2.2%; 8% only
# where the grade lifted exposure (circuit photos). Crushed: median 1.7%, dark rooms ~19%.
CLIP_HI_WARN = 3.0      # % of frame (bars excluded) at 252+ in any channel
CRUSH_WARN = 10.0       # % of frame at luma <= 4
# Skin tones (vectorscope). Natural skin of every complexion sits near the skin-tone
# line, ~123 deg (hue of Cr/Cb); complexion changes saturation and brightness, not hue.
# Colourist rule of thumb: within about +-10-12 deg, else it reads green/yellow (below)
# or magenta/red (above). Real faces here: 117-132 deg.
SKIN_HUE, SKIN_TOL = 123.0, 12.0
SKIN_SAT_WARN = 45      # chroma (8-bit units): orange, over-saturated skin
FACE_DARK_WARN = 55     # mean face luma: face lost in shadow
FACE_CLIP_WARN = 5.0    # % of face pixels clipped: burnt-out skin
SKIN_PIXELS_MIN = 0.4   # share of the face sample that is skin-coloured (else: a painting, mask, helmet)

fails, warns, lines = 0, 0, []
def out(kind, msg):
    global fails, warns
    fails += kind == "FAIL"
    warns += kind == "warn"
    lines.append(f"{kind:4} {msg}")

def run(*a, **k):
    return subprocess.run(list(a), capture_output=True, text=True, **k)

def ensure_swift(name):
    src, bin_ = f"scripts/{name}.swift", f".cache/{name}"
    if not os.path.exists(bin_) or os.path.getmtime(bin_) < os.path.getmtime(src):
        subprocess.run(["swiftc", "-O", src, "-o", bin_], check=True)
    return bin_

clips, allowed = None, {}
def frames():
    global clips, allowed
    if clips is None:
        r = run("npx", "tsx", "scripts/qa-frames.ts", slug)
        if r.returncode:
            sys.exit(r.stderr)
        data = json.loads(r.stdout.strip().splitlines()[-1])
        clips = data["clips"]
        allowed = {frozenset((x["a"], x["b"])): x["reason"] for x in data["allowSimilar"]}
    return clips

def exposure_and_skin(cl):
    """Highlight / shadow clipping per clip, and skin tones on every face Vision finds."""
    luma_w = np.array([0.299, 0.587, 0.114], np.float32)
    files = [f for c in cl for f in c["files"]]
    faces = {}
    for line in run(ensure_swift("saliency"), *files).stdout.splitlines():
        d = json.loads(line)
        faces[d["file"]] = d.get("faces", [])
    bad = 0
    for c in cl:
        hi = lo = 0.0
        skin = []
        for f in c["files"]:
            full = np.asarray(Image.open(f).convert("RGB"), np.float32)
            a = full[full.reshape(full.shape[0], -1).max(1) > 12]      # letterbox bars out
            hi = max(hi, float((a.max(2) >= 252).mean()) * 100)
            lo = max(lo, float(((a @ luma_w) <= 4).mean()) * 100)
            FH, FW = full.shape[:2]
            for x, y, w, h in faces.get(f, []):
                if w * FW < 12:
                    continue                                          # too small to judge
                p = full[int((y + 0.45 * h) * FH):int((y + 0.8 * h) * FH), int((x + 0.3 * w) * FW):int((x + 0.7 * w) * FW)].reshape(-1, 3)
                if len(p) < 30:
                    continue
                Y = p @ luma_w
                cb, cr = (p[:, 2] - Y) * 0.564, (p[:, 0] - Y) * 0.713
                k = (Y > 40) & (Y < 235) & (cr > 0) & (cb < 0)
                if k.mean() < SKIN_PIXELS_MIN:
                    continue                                          # not skin: painting, mask, visor
                hue = float(np.degrees(np.arctan2(cr[k].mean(), cb[k].mean())))
                skin.append({"hue": hue, "sat": float(np.hypot(cr[k].mean(), cb[k].mean())), "luma": float(Y.mean()),
                             "clip": float((p.max(1) >= 252).mean()) * 100})
        label = f"#{c['n']} {c['src']}"
        if hi > CLIP_HI_WARN:
            bad += 1
            out("warn", f"{label}: {hi:.1f}% of the frame burnt out to white (over {CLIP_HI_WARN}%): no detail there; "
                        "if the grade raises exposure, lower it on this clip")
        if lo > CRUSH_WARN:
            bad += 1
            out("warn", f"{label}: {lo:.1f}% of the frame crushed to black (over {CRUSH_WARN}%): fine for a night/mood shot, else lift shadows")
        if skin:
            hue = float(np.median([s_["hue"] for s_ in skin]))
            sat = float(np.median([s_["sat"] for s_ in skin]))
            lum = float(np.median([s_["luma"] for s_ in skin]))
            clip = max(s_["clip"] for s_ in skin)
            msgs = []
            if abs(hue - SKIN_HUE) > SKIN_TOL:
                # Vectorscope: red ~109 deg, yellow ~171 deg; skin sits between at ~123.
                msgs.append(f"skin hue {hue:.0f} deg, natural is {SKIN_HUE:.0f}+-{SKIN_TOL:.0f}: "
                            + ("too red/magenta: lower warmth or add a little green (- tint)" if hue < SKIN_HUE
                               else "too yellow/green: add a little magenta (+ tint) or cool slightly"))
            if sat > SKIN_SAT_WARN:
                msgs.append(f"skin over-saturated (chroma {sat:.0f} > {SKIN_SAT_WARN}): lower saturation on this clip")
            if lum < FACE_DARK_WARN:
                msgs.append(f"face in shadow (luma {lum:.0f} < {FACE_DARK_WARN}): lift exposure/midtones or pick a brighter moment")
            if clip > FACE_CLIP_WARN:
                msgs.append(f"{clip:.0f}% of the face burnt out: bring exposure down on this clip")
            for m in msgs:
                bad += 1
                if "skin" in c.get("allow", []) and "skin hue" in m:
                    out("warn", f"{label}: {m} -- allowed (allow: skin): not real skin, checked by eye")
                else:
                    out("warn", f"{label}: {m}")
            if not msgs:
                out("ok", f"{label}: skin {hue:.0f} deg, chroma {sat:.0f}, luma {lum:.0f} ({len(skin)} face samples)")
    if not bad:
        out("ok", f"exposure: no clipped highlights over {CLIP_HI_WARN}% or crushed shadows over {CRUSH_WARN}%")

def pre():
    cl = frames()
    files = [f for c in cl for f in c["files"]]
    m = json.loads(run(ensure_swift("featureprint"), *files).stdout)
    idx = {f: i for i, f in enumerate(files)}
    worst = []
    for a, b in itertools.combinations(cl, 2):
        d = min(m[idx[x]][idx[y]] for x in a["files"] for y in b["files"])
        worst.append(d)
        what = f"#{a['n']} {a['src']} and #{b['n']} {b['src']} look like the same scene (distance {d:.2f})"
        # A note names a clip by its file, or one clip of a file by "file@startAt" (two
        # shots from one long take, e.g. a GoPro flight). Same-file pairs need the @ form.
        at = lambda c: f"{c['src']}@{c['startAt']:g}"
        reason = allowed.get(frozenset((at(a), at(b))))
        if reason is None and a["src"] != b["src"]:
            reason = allowed.get(frozenset((a["src"], b["src"])))
        if d < REPEAT_WARN and reason:
            out("warn", f"{what}: allowed, checked by eye: {reason}")
        elif d < REPEAT_FAIL:
            out("FAIL", what)
        elif d < REPEAT_WARN:
            out("warn", what + ": check")
    out("ok", f"repeats: {len(cl)} clips, closest pair distance {min(worst):.2f} (fail < {REPEAT_FAIL})")
    # Colour/exposure jumps between neighbouring clips.
    def wb(path):
        a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32).reshape(-1, 3)
        mx, mn = a.max(1), a.min(1)
        n = a[(mx - mn < 0.25 * (mx + 1)) & (mx > 60) & (mx < 235)]
        luma = float((a @ np.array([0.299, 0.587, 0.114])).mean())
        if len(n) < 200:
            return None, None, luma
        r, g, b = n.mean(0)
        t = r + g + b
        return (r - b) / t, (g - (r + b) / 2) / t, luma
    jumps = 0
    for a, b in zip(cl, cl[1:]):
        ta, ia, la = wb(a["files"][2])
        tb, ib, lb = wb(b["files"][0])
        msgs = []
        if ta is not None and tb is not None and abs(tb - ta) > TEMP_JUMP:
            msgs.append(f"white balance jumps {'warmer' if tb > ta else 'cooler'} ({tb - ta:+.3f}); "
                        f"to even it: grade: {{ temperature: {-(tb - ta) / 0.1:+.2f} }} on #{b['n']}")
        if ia is not None and ib is not None and abs(ib - ia) > TINT_JUMP:
            msgs.append(f"tint jumps {'greener' if ib > ia else 'more magenta'} ({ib - ia:+.3f}); "
                        f"grade: {{ tint: {(ib - ia) / 0.1:+.2f} }} on #{b['n']}")
        ratio = max(la, lb) / max(1.0, min(la, lb))
        if ratio > LUMA_JUMP:
            stops = np.log2(la / max(1.0, lb))
            msgs.append(f"brightness jumps x{ratio:.1f}; grade: {{ exposure: {stops:+.2f} }} on #{b['n']} if unintended")
        for m in msgs:
            jumps += 1
            out("warn", f"cut #{a['n']}->#{b['n']}: {m}")
    if not jumps:
        out("ok", "colour: no white-balance or brightness jumps between neighbouring clips")
    exposure_and_skin(cl)
    lay = f"topics/{slug}/layout.json"
    if not os.path.exists(lay):
        out("FAIL", "no layout.json: run npm run layout first")
        return
    lj = json.load(open(lay))
    det = lj.get("used") or lj.get("detail", {})  # score of the position actually used
    for k in ("hook", "closing"):
        if k not in det:
            continue
        c = det[k]["cost"]
        if c >= TEXT_FACE_FAIL:
            out("FAIL", f"{k} text sits over a face (cost {c})")
        elif c >= TEXT_BUSY_WARN:
            out("warn", f"{k} text over a busy area (cost {c}); consider a calmer opening/closing shot")
        else:
            out("ok", f"{k} text placement clear (cost {c})")
    out("ok", f"text sheet out/qa/{slug}-text.jpg: check by eye that no box covers the subject at any moment")

def probe(path, entries):
    return json.loads(run("ffprobe", "-v", "error", "-show_entries", entries, "-of", "json", path).stdout)

def post():
    master, ig = f"out/{slug}.mp4", f"out/instagram/{slug}.mp4"
    for p in (master, ig):
        if not os.path.exists(p):
            out("FAIL", f"{p} missing: render first")
            return
    cl = frames()
    # Black frames anywhere.
    r = run("ffmpeg", "-i", master, "-vf", "blackdetect=d=0.1:pix_th=0.06", "-an", "-f", "null", "-")
    blacks = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", r.stderr)
    out("FAIL" if blacks else "ok", f"black frames: {blacks or 'none'}")
    # Frozen video inside video clips (photos are allowed to hold still).
    r = run("ffmpeg", "-i", master, "-vf", "freezedetect=n=0.001:d=0.8", "-an", "-f", "null", "-")
    st = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
    en = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", r.stderr)]
    frozen = [(a, b) for a, b in zip(st, en + [1e9]) for c in cl
              if c["video"] and max(a, c["from"]) < min(b, c["to"]) - 0.3]
    out("FAIL" if frozen else "ok", f"frozen video: {[(round(a,2), round(b,2)) for a, b in frozen] or 'none'}")
    # Audio. Instagram mode: the upload copy must carry NO audio (the guide track is
    # never uploaded; the sound is added in the app); the master keeps the guide.
    mode = run("npx", "tsx", "scripts/reel-info.ts", "mode", slug).stdout.strip()
    has_audio = lambda p: bool(run("ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                                   "-of", "csv=p=0", p).stdout.strip())
    if mode == "instagram":
        out("FAIL" if has_audio(ig) else "ok", f"instagram mode: upload copy {'HAS' if has_audio(ig) else 'has no'} audio")
        out("ok" if has_audio(master) else "FAIL", f"instagram mode: master {'has' if has_audio(master) else 'is missing'} the guide audio")
        card = f"out/instagram/{slug}-audio.txt"
        out("ok" if os.path.exists(card) else "FAIL", f"sync card {card}")
    else:
        post_audio(ig)
    post_rest(master, ig, cl)

def post_audio(ig):
    r = run("ffmpeg", "-i", ig, "-af", "ebur128=peak=true", "-f", "null", "-")
    lufs = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)[-1])
    tp = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", r.stderr)[-1])
    out("ok" if LUFS_RANGE[0] <= lufs <= LUFS_RANGE[1] else "warn", f"loudness {lufs} LUFS (Instagram ~-14; ok {LUFS_RANGE[0]} to {LUFS_RANGE[1]})")
    out("ok" if tp <= PEAK_MAX else "FAIL", f"true peak {tp} dBFS (max {PEAK_MAX})")
    r = run("ffmpeg", "-i", ig, "-af", "silencedetect=n=-45dB:d=0.5", "-f", "null", "-")
    dur = float(probe(ig, "format=duration")["format"]["duration"])
    gaps = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr) if float(x) < dur - 0.6]
    out("FAIL" if gaps else "ok", f"silent gaps: {gaps or 'none'}")

# Identifying text that must not be in an output file: encoder names and versions, the
# render engine's "Made with" comment, and content-credential / provenance markers
# (C2PA manifests, IPTC DigitalSourceType). Case-sensitive and at least 5 bytes long, so
# random bytes in the compressed video can't match by chance.
TRACES = [rb"Remotion", rb"x264 - core", rb"Lavf\d+\.", rb"Lavc\d+\.", rb"c2pa\.", rb"jumdc2pa",
          rb"DigitalSourceType", rb"trainedAlgorithmicMedia"]
TAGS_OK = {"major_brand", "minor_version", "compatible_brands", "language", "handler_name"}
HANDLERS_OK = {"VideoHandler", "SoundHandler"}

def post_meta(path):
    r = run("ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", path)
    j = json.loads(r.stdout)
    tags = dict(j.get("format", {}).get("tags", {}))
    for st in j.get("streams", []):
        for k, v in st.get("tags", {}).items():
            tags[f"stream.{k}"] = v
    bad = {k: v for k, v in tags.items() if k.split(".")[-1] not in TAGS_OK
           or (k.endswith("handler_name") and v not in HANDLERS_OK)}
    data = open(path, "rb").read()
    found = sorted({m.group().decode("latin-1") for t in TRACES for m in re.finditer(t, data)})
    out("FAIL" if bad or found else "ok", f"no tags in {path}: "
        + ("clean" if not (bad or found) else f"tags {bad or 'none'}, text {found or 'none'}"))

def post_rest(master, ig, cl):
    post_meta(master)
    post_meta(ig)
    # Instagram copy spec.
    v = probe(ig, "stream=codec_name,width,height,pix_fmt,color_primaries,r_frame_rate:format=duration,bit_rate")
    s0 = v["streams"][0]
    md = float(probe(master, "format=duration")["format"]["duration"])
    mbps = int(v["format"]["bit_rate"]) / 1e6
    spec = [s0["codec_name"] == "h264", (s0["width"], s0["height"]) == (1080, 1920), s0["pix_fmt"] == "yuv420p",
            s0.get("color_primaries") == "bt709", abs(float(v["format"]["duration"]) - md) < 0.06, mbps <= IG_MAX_MBPS]
    out("ok" if all(spec) else "FAIL", f"instagram copy: {s0['codec_name']} {s0['width']}x{s0['height']} {s0['pix_fmt']} "
        f"{s0.get('color_primaries')} {s0['r_frame_rate']} {mbps:.1f} Mbps, {float(v['format']['duration']):.2f}s vs master {md:.2f}s")
    # Cut sheet for the continuity pass: last frame out | first frame in.
    os.makedirs("out/qa", exist_ok=True)
    W, H = 180, 320
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
    except OSError:
        font = ImageFont.load_default()
    cuts = list(zip(cl, cl[1:]))
    cols = 3
    rows = (len(cuts) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (2 * W + 30), rows * (H + 28)), (16, 16, 16))
    d = ImageDraw.Draw(sheet)
    for i, (a, b) in enumerate(cuts):
        x, y = (i % cols) * (2 * W + 30), (i // cols) * (H + 28)
        sheet.paste(Image.open(a["files"][2]).convert("RGB").resize((W, H)), (x, y + 24))
        sheet.paste(Image.open(b["files"][0]).convert("RGB").resize((W, H)), (x + W + 4, y + 24))
        d.text((x + 2, y + 4), f"#{a['n']}->#{b['n']} at {b['from']:.2f}s", fill="yellow", font=font)
    sheet.save(f"out/qa/{slug}-cuts.jpg", quality=85)
    out("ok", f"cut sheet out/qa/{slug}-cuts.jpg ({len(cuts)} cuts): review continuity by eye")

if mode in ("--pre", "--both"):
    pre()
if mode in ("--post", "--both"):
    post()
print(f"== qa {slug}")
print("\n".join(lines))
print(f"{fails} failed, {warns} warnings")
sys.exit(1 if fails else 0)
