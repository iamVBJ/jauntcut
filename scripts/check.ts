// Checks a topic (or all) before rendering. Exits non-zero on any failure.
//  - every clip's prepared file exists (raw file listed if it was skipped)
//  - cover-fit x zoom x motion never upscales past 1:1
//  - video clips don't run past the end of their source
//  - the music covers the whole reel from its start point
// Usage: npm run check <slug>|all
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, STYLES } from "../src/config";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import {
  FPS, HEIGHT, MOTION_MAX_SCALE, PORTAL_INNER, PUSH_INTO_SCALE, WIDTH, settleScale, needsTrack, playPath, trackKey, beatFrame, bpmOf, hookEndFrame, clipStarts, derivedPath, isVideo, motionFor, musicStart, needsDerive,
  preparedPath, sourceSeconds, tailFrames, totalFrames, sketchPath, transitionOf, depthSlicePath
} from "../src/lib";

const target = process.argv[2] ?? "all";
const chosen = topics.filter((t) => target === "all" || t.slug === target);
if (chosen.length === 0) {
  console.log(`FAIL no topic "${target}" with a reel.ts. Topics: ${topics.map((t) => t.slug).join(", ")}`);
  process.exit(1);
}

const probe = (file: string) => {
  const j = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]).toString(),
  );
  const v = j.streams.find((s: { width?: number }) => s.width);
  return { w: v?.width ?? 0, h: v?.height ?? 0, dur: Number(j.format.duration) };
};

let failed = 0;
let checked = 0;
let warnings = 0;
for (const t of chosen) {
  const parsed = reelSchema.safeParse(t);
  if (!parsed.success) {
    failed++;
    console.log(`FAIL ${t.slug}: ${parsed.error.message}`);
    continue;
  }
  const reel = parsed.data;
  const starts = clipStarts(reel);
  const secs = totalFrames(reel) / FPS;
  const S = STYLES[reel.style];
  console.log(`== ${reel.slug}  ${reel.clips.length} clips, ${secs.toFixed(2)}s at ${bpmOf(reel)} BPM, ${reel.style} style`);
  checked++;
  const minSecs = reel.minSeconds ?? LIMITS.minSeconds;
  if (secs < minSecs || secs > LIMITS.maxSeconds) {
    failed++;
    console.log(`FAIL length ${secs.toFixed(2)}s is outside ${minSecs}-${LIMITS.maxSeconds}s`);
  } else if (secs < LIMITS.minSeconds) {
    warnings++;
    console.log(`warn length ${secs.toFixed(2)}s is under the project minimum ${LIMITS.minSeconds}s (reel allows ${minSecs}s)`);
  }
  reel.clips.forEach((clip, i) => {
    checked++;
    const label = `#${String(i + 1).padStart(2)} ${clip.src}`;
    const file = join("public", preparedPath(reel.slug, clip.src));
    if (!existsSync(file)) {
      failed++;
      const raw = join("topics", reel.slug, "raw", clip.src);
      console.log(`FAIL ${label}: ${existsSync(raw) ? "not prepared (or skipped as too small/HDR), run npm run media " + reel.slug : "not in " + raw}`);
      return;
    }
    const { w, h, dur } = probe(file);
    // Motion as rendered: footage without zoom headroom is held still automatically. A
    // settle move adds its own cover zoom; a parallax subject grows by its amount.
    const scale = Math.max(WIDTH / w, HEIGHT / h) * clip.zoom * (motionFor(reel, clip, i) === "still" ? 1 : motionFor(reel, clip, i) === "push-into" ? PUSH_INTO_SCALE : MOTION_MAX_SCALE) *
      settleScale(reel, clip) * (1 + (clip.parallax?.amount ?? 0)) * (1 + (clip.depth3d?.amount ?? 0)) *
      (i > 0 && transitionOf(clip) === "portal" ? PORTAL_INNER : 1);
    const problems: string[] = [];
    let warn = "";
    if (scale > 1 && clip.allow.includes("upscale")) {
      warnings++;
      warn = `  warn (allowed): enlarged ${scale.toFixed(2)}x from ${w}x${h}${clip.enhance ? " (enhanced: 60 fps, denoised, Lanczos, sharpened)" : ""}, softer than the rest`;
    } else if (scale > 1) problems.push(`needs ${scale.toFixed(2)}x, would upscale`);
    let used = "";
    if (isVideo(clip.src)) {
      const end = clip.startAt + sourceSeconds(reel, clip, starts[i].frames + tailFrames(reel, i));
      used = ` uses ${clip.startAt.toFixed(1)}-${end.toFixed(2)}s of ${dur.toFixed(2)}s`;
      if (end > dur) problems.push(`runs past the end of the source`);
      if (needsDerive(clip) && !existsSync(join("public", derivedPath(reel, clip, starts[i].frames + tailFrames(reel, i)))))
        problems.push(`derived clip (reverse/smooth/stabilize) not rendered: run npm run derive ${reel.slug}`);
      if (clip.interpolate && !existsSync(join("public", playPath(reel, clip))))
        problems.push(`60 fps interpolated copy not rendered: run npm run derive ${reel.slug}`);
      if (needsTrack(reel, i) && !reel.tracks[trackKey(clip, starts[i].frames + tailFrames(reel, i))])
        problems.push(`motion track / cutouts not rendered: run npm run derive ${reel.slug}`);
    }
    if (clip.depth3d && !Array.from({ length: clip.depth3d.layers - 1 }, (_, k) => existsSync(join("public", depthSlicePath(reel, clip, k + 1)))).every(Boolean))
      problems.push(`depth slices for the depth3d move not rendered: run npm run derive ${reel.slug}`);
    if (transitionOf(clip) === "sketch" && !existsSync(join("public", sketchPath(reel, clip)))) {
      problems.push(`pencil sketch for the sketch transition not rendered: run npm run derive ${reel.slug}`);
    }
    // Flagged frames (blur/shake/internal cut): fail unless the clip allows "flagged".
    const rep = join("review", reel.slug, "report.json");
    if (isVideo(clip.src) && existsSync(rep)) {
      const r = JSON.parse(readFileSync(rep, "utf8"))[clip.src.replace(/\.[^.]+$/, "")];
      const end = clip.startAt + sourceSeconds(reel, clip, starts[i].frames + tailFrames(reel, i));
      const bad = (r?.frames ?? []).filter(
        (f: { t: number; flags: string[] }) => f.flags.length && f.t >= clip.startAt - 0.25 && f.t < end,
      );
      if (bad.length && clip.allow.includes("flagged")) {
        warnings++;
        warn += `  warn (allowed): uses flagged frames ${bad.map((f: { t: number; flags: string[] }) => `${f.t}s ${f.flags.join("+")}`).join(", ")}`;
      }
      const burned = (r?.text ?? []).filter((x: { kind: string }) => x.kind === "overlay");
      if (burned.length) {
        warnings++;
        warn += `  warn: burned-in text "${burned.map((x: { text: string }) => x.text).join('", "')}" (edited elsewhere?): check it doesn't clash with the reel's text`;
      }
      if (bad.length && clip.allow.includes("flagged")) {
        // already reported above
      } else if (bad.length) {
        problems.push(`uses flagged frames ${bad.map((f: { t: number; flags: string[] }) => `${f.t}s ${f.flags.join("+")}`).join(", ")} (add allow: ["flagged"] if deliberate)`);
      }
    }
    if (problems.length) failed++; // every clip-level problem is a failure (was printed, not counted)
    console.log(`${problems.length ? "FAIL" : "ok  "} ${label.padEnd(20)} ${w}x${h} scale ${scale.toFixed(2)}${used}${problems.length ? "  " + problems.join("; ") : ""}${warn}`);
  });
  // Pacing: warn when cuts come too fast to take in.
  const secsEach = starts.map((x) => x.frames / FPS);
  const tooShort = secsEach.map((d, i) => ({ d, i })).filter(({ d }) => d < S.minClipSeconds);
  for (const { d, i } of tooShort) {
    warnings++;
    console.log(`warn #${i + 1} is ${d.toFixed(2)}s, under ${S.minClipSeconds}s: feels rushed`);
  }
  const avg = secsEach.reduce((a, b) => a + b, 0) / secsEach.length;
  if (avg < S.minAverageClipSeconds) {
    warnings++;
    console.log(`warn average clip ${avg.toFixed(2)}s, under ${S.minAverageClipSeconds}s: cuts too fast`);
  } else {
    console.log(`ok   pacing: ${secsEach.length} clips, average ${avg.toFixed(2)}s`);
  }
  // No repeats: a photo appears once; video footage never overlaps another clip.
  // A neighbouring clip continuing the same take is a jump cut (warning).
  const seenPhoto = new Map<string, number>();
  reel.clips.forEach((c, i) => {
    if (isVideo(c.src)) return;
    checked++;
    if (seenPhoto.has(c.src)) {
      failed++;
      console.log(`FAIL #${seenPhoto.get(c.src)} and #${i + 1} both use photo ${c.src} (crops count as repeats)`);
    } else seenPhoto.set(c.src, i + 1);
  });
  const ranges = reel.clips.map((c, i) =>
    isVideo(c.src) ? { src: c.src, a: c.startAt, b: c.startAt + sourceSeconds(reel, c, starts[i].frames + tailFrames(reel, i)) } : null,
  );
  ranges.forEach((r, i) => {
    if (!r) return;
    for (let j = 0; j < i; j++) {
      const q = ranges[j];
      if (!q || q.src !== r.src) continue;
      checked++;
      if (r.a < q.b - 0.04 && r.b > q.a + 0.04) {
        failed++;
        console.log(`FAIL #${j + 1} and #${i + 1} both show ${r.src} ${Math.max(q.a, r.a).toFixed(2)}-${Math.min(q.b, r.b).toFixed(2)}s`);
      } else if (Math.min(Math.abs(r.a - q.b), Math.abs(q.a - r.b)) < 1.5) {
        const ok = reel.clips[i].allow.includes("split") || reel.clips[j].allow.includes("split");
        if (ok) warnings++;
        else failed++;
        console.log(`${ok ? "warn" : "FAIL"} #${j + 1} and #${i + 1} split one continuous take of ${r.src}: use one clip`);
      }
    }
  });
  // Flow: no dead holds mid-reel, short openings, no static lead-ins.
  const rep = join("review", reel.slug, "report.json");
  const report = existsSync(rep) ? JSON.parse(readFileSync(rep, "utf8")) : {};
  type Fr = { t: number; active: number };
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  const hookSecs = hookEndFrame(reel) / FPS;
  reel.clips.forEach((c, i) => {
    checked++;
    const secs = starts[i].frames / FPS;
    const first = i === 0;
    const last = i === reel.clips.length - 1;
    const hold = c.allow.includes("hold");
    const flow = (msg: string, allowed: boolean) => {
      if (allowed) warnings++;
      else failed++;
      console.log(`${allowed ? "warn" : "FAIL"} #${i + 1} ${c.src}: ${msg}`);
    };
    if (first && secs > hookSecs + LIMITS.openingExtraSeconds + 0.01)
      flow(`opening runs ${secs.toFixed(2)}s, max ${(hookSecs + LIMITS.openingExtraSeconds).toFixed(2)}s (hook + ${LIMITS.openingExtraSeconds}s)`, hold);
    if (last && secs > S.maxClosingSeconds + 0.01) flow(`closing holds ${secs.toFixed(2)}s, max ${S.maxClosingSeconds}s`, hold);
    if (first || last) return;
    if (!isVideo(c.src)) {
      if (secs > S.maxHold.photo + 0.01) flow(`photo holds ${secs.toFixed(2)}s mid-reel, max ${S.maxHold.photo}s`, hold);
      // A depth3d or settle move is the photo's motion (its preset is "still" so the two
      // don't stack).
      if (c.motion === "still" && !c.depth3d && !c.settle) flow(`photo mid-reel with no motion`, hold);
      return;
    }
    const fr: Fr[] = report[c.src.replace(/\.[^.]+$/, "")]?.frames ?? [];
    const end = c.startAt + sourceSeconds(reel, c, starts[i].frames + tailFrames(reel, i));
    const inClip = fr.filter((f) => f.t >= c.startAt - 0.01 && f.t < end);
    if (!inClip.length) return;
    const act = median(inClip.map((f) => f.active));
    const kind = act < LIMITS.stillActivity ? "still" : act < LIMITS.movingActivity ? "gentle" : "moving";
    const max = S.maxHold[kind];
    if (secs > max + 0.01) flow(`${kind} shot (activity ${act.toFixed(0)}) holds ${secs.toFixed(2)}s mid-reel, max ${max}s`, hold);
  });
  // Reading speed: can the audience read the text in the time it is on screen?
  {
    checked++;
    const readable = (chars: number, frames: number, label: string) => {
      const secs = frames / FPS;
      const cps = chars / Math.max(0.01, secs);
      if (cps > LIMITS.maxCharsPerSecond) {
        warnings++;
        console.log(`warn ${label} "${chars} characters" readable for ${secs.toFixed(2)}s = ${cps.toFixed(1)} chars/s, over ${LIMITS.maxCharsPerSecond}: shorten it or hold it longer`);
      } else console.log(`ok   ${label} reading speed ${cps.toFixed(1)} chars/s`);
    };
    // Words reveal over ~0.3 s (calm) or one per half-beat (energetic); leave time after.
    const words = reel.hook.split(" ").length;
    const reveal = reel.style === "energetic" ? beatFrame(reel, 0.5) * words : Math.round(0.3 * FPS);
    readable(reel.hook.length, hookEndFrame(reel) - reveal, "hook");
    if (reel.closing) readable(reel.closing.length, starts[starts.length - 1].frames - Math.round(0.3 * FPS), "closing");
  }
  // Static lead-in: the first second is still while the take moves later.
  reel.clips.forEach((c, i) => {
    if (!isVideo(c.src)) return;
    const fr: Fr[] = report[c.src.replace(/\.[^.]+$/, "")]?.frames ?? [];
    const end = c.startAt + sourceSeconds(reel, c, starts[i].frames + tailFrames(reel, i));
    const head = fr.filter((f) => f.t >= c.startAt - 0.01 && f.t < c.startAt + 1.0);
    const rest = fr.filter((f) => f.t >= c.startAt + 1.0 && f.t < end);
    if (head.length < 2 || !rest.length) return;
    if (Math.max(...head.map((f) => f.active)) < LIMITS.movingActivity && median(rest.map((f) => f.active)) > 1.5 * LIMITS.movingActivity) {
      const go = fr.find((f) => f.t >= c.startAt && f.active >= LIMITS.movingActivity);
      const ok = c.allow.includes("leadin");
      if (ok) warnings++;
      else failed++;
      console.log(`${ok ? "warn" : "FAIL"} #${i + 1} ${c.src}: starts on a still lead-in; the move begins at ~${go?.t.toFixed(1)}s (startAt ${c.startAt})`);
    }
  });
  checked++;
  if (!reel.track.file) {
    console.log(`note no music yet: cuts use ${bpmOf(reel)} BPM, reel will be silent`);
  } else {
    const f = join("public", reel.slug, reel.track.file);
    const start = musicStart(reel);
    if (!existsSync(f)) {
      failed++;
      console.log(`FAIL music ${f} missing, run npm run media ${reel.slug}`);
    } else if (start + secs > reel.track.duration) {
      failed++;
      console.log(`FAIL music: starts at ${start.toFixed(2)}s, reel needs ${secs.toFixed(2)}s, track is ${reel.track.duration}s`);
    } else {
      console.log(`ok   music ${reel.track.source}: ${start.toFixed(2)}-${(start + secs).toFixed(2)}s of ${reel.track.duration}s`);
    }
  }
}
console.log(`\n${checked} checked, ${failed} failed, ${warnings} warnings`);
process.exit(failed ? 1 : 0);
