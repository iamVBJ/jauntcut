// Pre-renders what Remotion can't do live, into public/<slug>/derived/:
//   reverse    the moment played backwards
//   smooth     real slow motion (frame interpolation) for speed < 1
//   stabilize  steadied handheld footage (scripts/stab.swift, gimbal-style)
//   freeze     the still of a freeze frame
//   behind     subject cutout mask of a photo (title behind the people)
//   scene / subject-wipe   motion track + per-frame subject cutouts (scripts/track.py)
// Each file covers exactly the source window the clip uses, so a re-run only
// renders what changed. Usage: npm run derive <slug>|all
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { FPS, glowFilter, paintFilter, paintName, clipStarts, derivedName, interpName, playPath, maskName, needsTrack, sourceTimeAt, trackKey, freezeName, freezeSeconds, isVideo, needsDerive, preparedPath, sourceWindow, tailFrames, sketchName, transitionOf } from "../src/lib";

// The Vision cutout tool, compiled once (and again whenever its source changes).
const CUT_BIN = ".cache/bin/subjectmask";
// Depth maps for depth3d moves: scripts/depth.swift with Depth Anything V2 Small (Apple's
// Core ML build, runs locally).
const DEPTH_BIN = ".cache/bin/depth";
const DEPTH_MODEL = ".cache/models/DepthAnythingV2SmallF16.mlpackage";
// The depth an iPhone recorded with a photo (scripts/phonedepth.swift), for depth3d.phone.
const PHONE_BIN = ".cache/bin/phonedepth";
// Face boxes per frame (scripts/faces.swift), for faceLift.
const FACES_BIN = ".cache/bin/faces";
// Stabiliser (scripts/stab.swift), for clip.stabilize.
const STAB_BIN = ".cache/bin/stab";
const compiled = (bin: string, src: string) => {
  if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(".cache/bin", { recursive: true });
    execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "inherit" });
  }
};
const CUT_SRC = "scripts/subjectmask.swift";
if (!existsSync(CUT_BIN) || statSync(CUT_BIN).mtimeMs < statSync(CUT_SRC).mtimeMs) {
  mkdirSync(".cache/bin", { recursive: true });
  console.log("compiling the cutout tool");
  execFileSync("swiftc", ["-O", CUT_SRC, "-o", CUT_BIN], { stdio: "inherit" });
}

const target = process.argv[2] ?? "all";
const chosen = topics.filter((t) => target === "all" || t.slug === target);
if (!chosen.length) throw new Error(`no topic ${target}`);

for (const t of chosen) {
  const reel = reelSchema.parse(t);
  const starts = clipStarts(reel);
  const dir = join("public", reel.slug, "derived");
  const wanted = new Set<string>();
  const tracks: Record<string, unknown> = {};
  reel.clips.forEach((clip, i) => {
    if (clip.interpolate) {
      // Whole file, once: motion-compensated in-between frames.
      const name = interpName(clip);
      wanted.add(name);
      const out = join(dir, name);
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true });
        console.log(`derive #${i + 1} ${clip.src}: interpolating to 60 fps (a few minutes)`);
        execFileSync("ffmpeg", [
          "-v", "error", "-y", "-i", join("public", preparedPath(reel.slug, clip.src)), "-an",
          "-vf", "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p",
          "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-g", "30",
          "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", out,
        ]);
      }
    }
  });
  reel.clips.forEach((clip, i) => {
    if (needsTrack(reel, i)) {
      // Track every output frame the clip is on screen, including a transition tail.
      const frames = starts[i].frames + tailFrames(reel, i);
      const key = trackKey(clip, frames);
      wanted.add(key);
      const tdir = join(dir, key);
      if (!existsSync(join(tdir, "track.json"))) {
        mkdirSync(tdir, { recursive: true });
        const times = Array.from({ length: frames }, (_, f) => sourceTimeAt(reel, clip, f));
        // Track the ground band around scene text (where the letters stand), or the frame.
        const region = clip.scene ? [Math.max(0, clip.scene.y - (clip.scene.size * 1.4) / 1920), Math.min(1, clip.scene.y + 0.1)] : [0, 1];
        writeFileSync(join(tdir, "times.json"), JSON.stringify({ times, w: 1080, h: 1920, region }));
        console.log(`derive #${i + 1} ${clip.src}: motion track + cutouts, ${frames} frames`);
        execFileSync("python3", ["scripts/track.py", join("public", playPath(reel, clip)), join(tdir, "times.json"), tdir], { stdio: "inherit" });
      }
      tracks[key] = JSON.parse(readFileSync(join(tdir, "track.json"), "utf8"));
    }
    if (clip.behind || clip.parallax) {
      const name = maskName(clip);
      wanted.add(name);
      const out = join(dir, name);
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true });
        console.log(`derive #${i + 1} ${clip.src}: subject cutout`);
        execFileSync(CUT_BIN, [join("public", preparedPath(reel.slug, clip.src)), out], { stdio: "inherit" });
      }
    }
    if (clip.depth3d && !isVideo(clip.src)) {
      const L = clip.depth3d.layers;
      const base = clip.src.replace(/\.[^.]+$/, "");
      const names = Array.from({ length: L - 1 }, (_, k) => `${base}.d${k + 1}.png`);
      names.forEach((nm) => wanted.add(nm));
      // Where the depth comes from; recorded next to the slices so a change rebuilds them.
      const phone = clip.depth3d.phone;
      const source = phone === false ? "model" : `phone:${phone === true ? clip.src : phone}`;
      const stamp = join(dir, `${base}.depth.txt`);
      // Layer count or source changed: rebuild (stale slices from another count are dropped below).
      if (!names.every((nm) => existsSync(join(dir, nm))) || existsSync(join(dir, `${base}.d${L}.png`))
          || !existsSync(stamp) || readFileSync(stamp, "utf8") !== source) {
        mkdirSync(dir, { recursive: true });
        const dpng = join(dir, `${base}.depth.png`);
        console.log(`derive #${i + 1} ${clip.src}: depth map (${source}) + ${L - 1} slices`);
        if (phone === false) {
          compiled(DEPTH_BIN, "scripts/depth.swift");
          execFileSync(DEPTH_BIN, [DEPTH_MODEL, join("public", preparedPath(reel.slug, clip.src)), dpng], { stdio: "inherit" });
        } else {
          compiled(PHONE_BIN, "scripts/phonedepth.swift");
          execFileSync(PHONE_BIN, [join("topics", reel.slug, "raw", phone === true ? clip.src : phone), dpng], { stdio: "inherit" });
        }
        execFileSync("python3", ["scripts/depth_slices.py", dpng, dir, base, String(L)], { stdio: "inherit" });
        writeFileSync(stamp, source);
      }
      wanted.add(`${base}.depth.png`);
      wanted.add(`${base}.depth.txt`);
    }
    if (clip.paint > 0 && !isVideo(clip.src)) {
      // Painted copy of the photo at its own size (a multiple of 4 for the quarter-size pass).
      const name = paintName(clip);
      wanted.add(name);
      const out = join(dir, name);
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true });
        const src = join("public", preparedPath(reel.slug, clip.src));
        const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src], { encoding: "utf8" })
          .trim().split(",").map((v) => Math.floor(Number(v) / 4) * 4);
        console.log(`derive #${i + 1} ${clip.src}: painted ${clip.paint}`);
        execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `${paintFilter(clip.paint, w, h)},format=yuvj444p`, "-q:v", "2", out]);
      }
    }
    if (transitionOf(clip) === "sketch" && !isVideo(clip.src)) {
      const name = sketchName(clip);
      wanted.add(name);
      const out = join(dir, name);
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true });
        console.log(`derive #${i + 1} ${clip.src}: pencil sketch`);
        execFileSync("python3", ["scripts/sketch.py", join("public", preparedPath(reel.slug, clip.src)), out], { stdio: "inherit" });
      }
    }
    if (clip.freeze && isVideo(clip.src)) {
      // The exact source frame the clip reaches at the freeze beat.
      const name = freezeName(reel, clip);
      wanted.add(name);
      const out = join(dir, name);
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true });
        const t = freezeSeconds(reel, clip);
        console.log(`derive #${i + 1} ${clip.src}: freeze frame at ${t.toFixed(3)}s`);
        execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join("public", playPath(reel, clip)), "-ss", t.toFixed(3), "-frames:v", "1", out]);
      }
    }
    if (!needsDerive(clip)) return;
    const frames = starts[i].frames + tailFrames(reel, i);
    const name = derivedName(reel, clip, frames);
    wanted.add(name);
    const out = join(dir, name);
    if (existsSync(out)) return;
    mkdirSync(dir, { recursive: true });
    const { a, b } = sourceWindow(reel, clip, frames);
    const filters: string[] = [];
    const raw = join("topics", reel.slug, "raw", clip.src);
    // enhance reads the camera original, not the prepared re-encode.
    let input = clip.enhance && existsSync(raw) ? raw : join("public", preparedPath(reel.slug, clip.src));
    let seek = ["-ss", a.toFixed(3), "-t", (b - a).toFixed(3)];
    if (clip.stabilize) {
      // Gimbal-style stabilising of the window (scripts/stab.swift: Vision registration on
      // the upper frame, Gaussian-smoothed path, just enough zoom to hide the edges), then
      // the other passes on it.
      compiled(STAB_BIN, "scripts/stab.swift");
      const [w, h, r] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", input], { encoding: "utf8" }).trim().split(",");
      execFileSync("bash", ["-c", `set -o pipefail; "${STAB_BIN}" "$0" ${a.toFixed(3)} ${(b - a).toFixed(3)} auto 18 | ffmpeg -v error -y -f rawvideo -pix_fmt bgra -s ${w}x${h} -r ${r} -i - -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p "$1"`, input, `${out}.stab.mp4`], { stdio: ["ignore", "inherit", "inherit"] });
      input = `${out}.stab.mp4`;
      seek = [];
    }
    if (clip.enhance) {
      // 60 fps in-betweens at the native size (cheaper and cleaner than after scaling),
      // then denoise, enlarge to the output height and restore edge contrast.
      filters.push(`minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
        "hqdn3d=1.5:1.5:4:4", "scale=-2:1920:flags=lanczos", "cas=0.6");
    }
    if (clip.smooth) {
      // Stretch time by 1/speed, then synthesise the in-between frames.
      filters.push(`setpts=PTS/${clip.speed}`, `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
    }
    if (clip.reverse) filters.push("reverse");
    if (clip.glow) filters.push(glowFilter(clip.glow, b - a));
    if (clip.paint > 0) filters.push(paintFilter(clip.paint));
    filters.push("format=yuv420p");
    console.log(`derive #${i + 1} ${clip.src} ${a.toFixed(2)}-${b.toFixed(2)}s: ${[clip.stabilize && "stabilize", clip.smooth && `smooth x${clip.speed}`, clip.reverse && "reverse", clip.enhance && "enhance", clip.faceLift > 0 && `face lift ${clip.faceLift}`, clip.glow && "lights coming up", clip.paint > 0 && `painted ${clip.paint}`].filter(Boolean).join(", ")}`);
    execFileSync("ffmpeg", [
      "-v", "error", "-y", ...seek, "-i", input,
      "-an", "-vf", filters.join(","), "-c:v", "libx264", "-preset", "slow", "-crf", clip.enhance ? "14" : "16", "-g", "30",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", clip.faceLift > 0 ? `${out}.base.mp4` : out,
    ]);
    if (clip.stabilize) rmSync(`${out}.stab.mp4`);
    if (clip.faceLift > 0) {
      compiled(FACES_BIN, "scripts/faces.swift");
      execFileSync("python3", ["scripts/facelift.py", `${out}.base.mp4`, out, String(clip.faceLift)], { stdio: "inherit" });
      rmSync(`${out}.base.mp4`);
    }
  });
  // Remove derived files no clip uses any more.
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (!wanted.has(f)) rmSync(join(dir, f), { recursive: true });
  }
  // Tracks go next to the reel so the composition can import them.
  const tracksFile = join("topics", reel.slug, "tracks.json");
  if (Object.keys(tracks).length) writeFileSync(tracksFile, JSON.stringify(tracks));
  else if (existsSync(tracksFile)) rmSync(tracksFile);
  console.log(`${reel.slug}: ${wanted.size} derived file(s) ready`);
}
// Re-generate the topic list so new / removed tracks.json files are imported.
execFileSync("npx", ["tsx", "scripts/topics.ts"], { stdio: "inherit" });
