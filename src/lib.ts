import type { Clip, Motion, Reel, Transition } from "./schema";

// 60 fps: iPhone footage is shot at 60, and pans/zooms judder at 30.
export const FPS = 60;
// Timings below were designed at 30 fps; fr() converts them so they last the same time.
export const fr = (frames30: number) => Math.round((frames30 * FPS) / 30);
export const WIDTH = 1080;
export const HEIGHT = 1920;

// Instagram UI covers these areas. Text stays out of them.
export const SAFE = { top: 250, bottom: 400, left: 90, right: 150 };

// Largest scale the motion presets reach. Used by the no-upscale check.
export const MOTION_MAX_SCALE = 1.1;
// push-into: zoom reached at the end of the clip (and its transition), and the share of
// the move that is constant speed (the rest accelerates: log-zoom = a*p + (1-a)*p^2).
export const PUSH_INTO_SCALE = 1.6;
export const PUSH_INTO_LINEAR = 0.5;
// Portal: the incoming shot keeps moving forward as it comes through the opening, ending
// this much closer (and staying there for the rest of its clip, so nothing snaps back).
export const PORTAL_INNER = 1.1;
export const WHIP_FRAMES = fr(5);

// Text block heights as a fraction of frame height (for placement), and the
// range their centres may sit in without entering Instagram's UI zones.
export const TEXT_BOX = { hook: 0.15, closing: 0.1 };
export const textRange = (h: number) => [SAFE.top / HEIGHT + h / 2, 1 - SAFE.bottom / HEIGHT - h / 2];
const PRESET = { upper: { hook: 0.27, closing: 0.24 }, center: { hook: 0.5, closing: 0.5 }, lower: { hook: 0.68, closing: 0.7 } };
export const textY = (reel: Reel, which: "hook" | "closing") => {
  const pos = which === "hook" ? reel.hookPosition : reel.closingPosition;
  if (typeof pos === "number") return pos;
  if (pos !== "auto") return PRESET[pos][which];
  return (which === "hook" ? reel.layout.hookY : reel.layout.closingY) ?? 0.5;
};

export const bpmOf = (reel: Reel) => reel.music.bpm ?? reel.track.bpm;

// Instagram mode: the guide audio starts at the video's first frame (that's where
// Instagram starts the snippet), so cuts sit on the guide's beats: offset by firstBeat.
export const instagramMode = (reel: Reel) => reel.music.mode === "instagram";
export const firstBeatOf = (reel: Reel) => reel.music.firstBeat ?? reel.track.firstBeat;
export const beatOffsetFrames = (reel: Reel) => (instagramMode(reel) ? Math.round(firstBeatOf(reel) * FPS) : 0);
// Where the reel starts in the track, snapped to the nearest beat so cuts stay on the grid.
export const musicStart = (reel: Reel) => {
  if (instagramMode(reel)) return 0;
  const want = reel.music.startAt ?? reel.track.suggestedStart;
  const spb = 60 / bpmOf(reel);
  return Math.max(0, firstBeatOf(reel) + Math.round((want - firstBeatOf(reel)) / spb) * spb);
};

// Frame where beat n lands. Rounded per beat so cuts never drift off the grid.
export const beatFrame = (reel: Reel, n: number) => Math.round((n * 60 * FPS) / bpmOf(reel));

export const clipStarts = (reel: Reel) => {
  let beat = 0;
  const off = beatOffsetFrames(reel);
  return reel.clips.map((c, i) => {
    const from = i === 0 ? 0 : beatFrame(reel, beat) + off;
    beat += c.beats;
    return { from, frames: beatFrame(reel, beat) + off - from, beat: beat - c.beats };
  });
};

export const totalBeats = (reel: Reel) => reel.clips.reduce((a, c) => a + c.beats, 0);
// The hook text ends on the beat (shifted with the guide's first beat in instagram mode).
export const hookEndFrame = (reel: Reel) => beatFrame(reel, reel.hookBeats) + beatOffsetFrames(reel);
export const totalFrames = (reel: Reel) => beatFrame(reel, totalBeats(reel)) + beatOffsetFrames(reel);

// Transitions: what comes into clip i, and how long it lasts (frames).
export const transitionOf = (clip: Clip): Transition => clip.transition ?? (clip.whip ? "whip" : "cut");
const TRANSITION_SECONDS: Record<Transition, number> = {
  cut: 0, whip: 5 / 30, dissolve: 0.5, "dip-black": 0.4, "dip-white": 0.3, zoom: 0.25, blur: 0.3, glitch: 0.2, "subject-wipe": 0.6, portal: 0.8, bloom: 0.9, ripple: 0.8, match: 1.8, luma: 1.4, sketch: 0.96, glaze: 0.96,
};
export const transitionFrames = (clip: Clip) =>
  transitionOf(clip) === "whip" && clip.transitionSeconds === undefined
    ? WHIP_FRAMES
    : Math.round((clip.transitionSeconds ?? TRANSITION_SECONDS[transitionOf(clip)]) * FPS);
// A dissolve into clip i+1 keeps clip i playing underneath for the overlap.
export const tailFrames = (reel: Reel, i: number) => {
  const next = reel.clips[i + 1];
  return next && (transitionOf(next) === "dissolve" || transitionOf(next) === "subject-wipe" || transitionOf(next) === "portal" || transitionOf(next) === "ripple" || transitionOf(next) === "match" || transitionOf(next) === "luma" || transitionOf(next) === "sketch") ? transitionFrames(next) : 0;
};

// Footage with no room to zoom (e.g. a 1080x1920 export) stays still: never upscale.
export const motionFor = (reel: Reel, clip: Clip, index: number): Motion => {
  if (clip.motion) return clip.motion;
  const m = reel.media[clip.src.replace(/\.[^.]+$/, "")];
  if (m && Math.max(WIDTH / m.w, HEIGHT / m.h) * clip.zoom * MOTION_MAX_SCALE > 1) return "still";
  return autoMotion(index);
};

// Clips that need a pre-rendered file (reverse / smooth slow-mo / stabilise).
export const needsDerive = (clip: Clip) => isVideo(clip.src) && (clip.reverse || clip.smooth || clip.stabilize || clip.enhance || clip.faceLift > 0 || clip.paint > 0 || !!clip.glow);
// Source seconds [a, b] the clip reads (including a dissolve tail).
export const sourceWindow = (reel: Reel, clip: Clip, frames: number) => ({
  a: clip.startAt,
  b: clip.startAt + sourceSeconds(reel, clip, frames),
});
export const derivedName = (reel: Reel, clip: Clip, frames: number) => {
  const { a, b } = sourceWindow(reel, clip, frames);
  const ops = [clip.stabilize && "stab", clip.smooth && `smooth${clip.speed}`, clip.reverse && "rev", clip.enhance && "enh", clip.faceLift > 0 && `face${clip.faceLift}`, clip.paint > 0 && `paint${clip.paint}`, clip.glow && `glow${clip.glow.from}-${clip.glow.to}`].filter(Boolean).join("-");
  return `${clip.src.replace(/\.[^.]+$/, "")}.${ops}.${a.toFixed(3)}-${b.toFixed(3)}.mp4`;
};
export const derivedPath = (reel: Reel, clip: Clip, frames: number) => `${reel.slug}/derived/${derivedName(reel, clip, frames)}`;
// Freeze frame: clip-local frame where the picture stops, and the still shown after it.
export const freezeFrame = (reel: Reel, clip: Clip) => (clip.freeze ? beatFrame(reel, clip.freeze.atBeat) : Infinity);
export const freezeSeconds = (reel: Reel, clip: Clip) => clip.startAt + sourceSeconds(reel, clip, freezeFrame(reel, clip));
export const freezeName = (reel: Reel, clip: Clip) => `${clip.src.replace(/\.[^.]+$/, "")}.freeze.${freezeSeconds(reel, clip).toFixed(3)}.png`;
export const freezePath = (reel: Reel, clip: Clip) => `${reel.slug}/derived/${freezeName(reel, clip)}`;
// Motion track + subject cutouts of a video clip (scene text, subject wipes), keyed by
// exactly what the clip shows, so a re-cut re-tracks.
export const needsTrack = (reel: Reel, i: number) =>
  isVideo(reel.clips[i].src) && (!!reel.clips[i].scene || (reel.clips[i + 1] && transitionOf(reel.clips[i + 1]) === "subject-wipe"));
export const trackKey = (clip: Clip, frames: number) => {
  const sig = JSON.stringify([clip.src, clip.startAt, frames, clip.speed, clip.ramp, clip.rampIn, clip.rampOut, clip.rampBeats, clip.freeze, clip.interpolate, clip.scene?.y, clip.scene?.size]);
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h * 33) ^ sig.charCodeAt(i)) >>> 0;
  return `${clip.src.replace(/\.[^.]+$/, "")}.trk.${h.toString(16)}`;
};
// Source time shown at output frame f of a clip (what the tracker must look at).
export const sourceTimeAt = (reel: Reel, clip: Clip, f: number) => clip.startAt + sourceSeconds(reel, clip, f);
// 60 fps motion-interpolated copy of a 30 fps video (clip.interpolate).
export const interpName = (clip: Clip) => `${clip.src.replace(/\.[^.]+$/, "")}.i60.mp4`;
// The file a video clip plays from (and that tracking / freeze frames read).
export const playPath = (reel: Reel, clip: Clip) =>
  clip.interpolate ? `${reel.slug}/derived/${interpName(clip)}` : preparedPath(reel.slug, clip.src);
// Subject cutout of a photo (for `behind` titles).
export const maskName = (clip: Clip) => `${clip.src.replace(/\.[^.]+$/, "")}.mask.png`;
export const maskPath = (reel: Reel, clip: Clip) => `${reel.slug}/derived/${maskName(clip)}`;
// Depth slices of a photo for a depth3d move (scripts/depth_slices.py via derive).
export const depthSlicePath = (reel: Reel, clip: Clip, k: number) => `${reel.slug}/derived/${clip.src.replace(/\.[^.]+$/, "")}.d${k}.png`;
// Pencil sketch of a photo for the sketch transition (scripts/sketch.py via derive).
export const sketchName = (clip: Clip) => `${clip.src.replace(/\.[^.]+$/, "")}.sketch.png`;
export const sketchPath = (reel: Reel, clip: Clip) => `${reel.slug}/derived/${sketchName(clip)}`;

const MOTION_CYCLE: Motion[] = ["push-in", "pan-left", "pull-out", "pan-up", "pan-right", "push-in", "pan-down", "pull-out"];
export const autoMotion = (i: number): Motion => MOTION_CYCLE[i % MOTION_CYCLE.length];

const VIDEO = /\.(mov|mp4|m4v|webm)$/i;
export const isVideo = (src: string) => VIDEO.test(src);
// Raw file name -> prepared file inside public/<slug>/.
// Painted copy of a photo (clip.paint, via derive).
export const paintName = (clip: Clip) => `${clip.src.replace(/\.[^.]+$/, "")}.paint${clip.paint}.jpg`;
export const paintPath = (reel: Reel, clip: Clip) => `${reel.slug}/derived/${paintName(clip)}`;
// ffmpeg filter for clip.paint (one input, one output, at w x h, both divisible by 4):
// the footage lightly graded, mixed at strength p with a painted version of itself (colour
// flattened at quarter size by repeated bilateral blurs, ink lines from the edges, a soft
// bloom). Line and bloom widths scale with the size, so photos and videos match.
export const paintFilter = (p: number, w = 1440, h = 2560) => {
  const k = w / 1440;
  return `scale=${w}:${h},format=gbrp,split=4[o][a][b][c];` +
    "[o]eq=saturation=1.15:gamma=1.05,colorbalance=rs=-0.03:bs=0.05:rh=0.04:gh=0.02:bh=-0.02[og];" +
    `[a]scale=${w / 4}:${h / 4}:flags=area,bilateral=sigmaS=4:sigmaR=0.18,bilateral=sigmaS=4:sigmaR=0.18,bilateral=sigmaS=4:sigmaR=0.18,` +
    `median=radius=1,scale=${w}:${h}:flags=bicubic,eq=saturation=1.35:gamma=1.08:contrast=1.06,` +
    "colorbalance=rs=-0.05:bs=0.07:rh=0.05:gh=0.03:bh=-0.03,format=gbrp[pt];" +
    `[b]gblur=sigma=${(1.9 * k).toFixed(2)},edgedetect=low=0.07:high=0.2,negate,format=gbrp[ln];` +
    "[pt][ln]blend=all_mode=multiply:all_opacity=0.6[pl];" +
    `[c]curves=all='0/0 0.7/0.1 1/1',gblur=sigma=${Math.round(53 * k)}[bl];` +
    "[pl][bl]blend=all_mode=screen:all_opacity=0.4[pa];" +
    `[og][pa]blend=all_mode=normal:all_opacity=${p}`;
};
// ffmpeg filter for clip.glow over a window of `secs`: warm highlight bloom, screen
// strength ramping from `from` to `to`.
export const glowFilter = (g: { from: number; to: number }, secs: number) =>
  "format=gbrp,split[g0][g1];[g1]curves=all='0/0 0.55/0.05 1/1',colorbalance=rh=0.15:gh=0.05:bh=-0.12:rm=0.1:bm=-0.08,gblur=sigma=40[gb];" +
  `[g0][gb]blend=all_expr='A+(B-A*B/255)*(${g.from}+${g.to - g.from}*min(1\,T/${secs.toFixed(3)}))'`;

export const preparedPath = (slug: string, src: string) =>
  `${slug}/${src.replace(/\.[^.]+$/, "")}.${isVideo(src) ? "mp4" : "jpg"}`;

// Source seconds a video clip consumes, including any ramp.
// Speed curves (rampIn / rampOut for whips): playback speed at clip-local frame f of a
// clip `frames` long. rampOut eases up toward the cut (ignored on a frozen clip).
export const hasCurve = (clip: Clip) => clip.rampIn > 1 || clip.rampOut > 1;
const smooth = (t: number) => t * t * (3 - 2 * t);
export const speedAt = (reel: Reel, clip: Clip, f: number, frames: number) => {
  const base = clip.ramp && f >= beatFrame(reel, clip.ramp.atBeat) ? clip.ramp.speed : clip.speed;
  const rb = Math.max(1, (clip.rampBeats * 60 * FPS) / bpmOf(reel));
  let m = 1;
  if (clip.rampIn > 1 && f < rb) m *= 1 + (clip.rampIn - 1) * (1 - smooth(f / rb));
  if (clip.rampOut > 1 && !clip.freeze && f > frames - rb) m *= 1 + (clip.rampOut - 1) * smooth((f - (frames - rb)) / rb);
  return base * m;
};
// Source seconds read after f frames on a speed curve (frame-exact sum).
export const curveOffset = (reel: Reel, clip: Clip, f: number, frames: number) => {
  let s = 0;
  for (let k = 0; k < f; k++) s += speedAt(reel, clip, k + 0.5, frames);
  return s / FPS;
};

export const sourceSeconds = (reel: Reel, clip: Clip, framesIn: number) => {
  // A frozen clip stops reading the source at the freeze.
  const frames = clip.freeze ? Math.min(framesIn, freezeFrame(reel, clip)) : framesIn;
  if (hasCurve(clip)) return curveOffset(reel, clip, frames, framesIn);
  const at = clip.ramp ? Math.min(beatFrame(reel, clip.ramp.atBeat), frames) : frames;
  return (at * clip.speed + (frames - at) * (clip.ramp?.speed ?? clip.speed)) / FPS;
};

// Photo `settle`: offset (output px) and rotation (deg) at frame f of the clip.
export const settleAt = (reel: Reel, clip: Clip, f: number) => {
  const st = clip.settle!;
  const k = Math.min(1, Math.max(0, f / beatFrame(reel, st.beats)));
  const left = Math.pow(1 - k, 4); // ease-out: arrives moving fast, lands softly
  const frames = clipFramesOf(reel, clip);
  const turn = st.turn * (Math.min(1, Math.max(0, f / frames)) - 0.5);
  return { x: st.x * WIDTH * left, y: st.y * HEIGHT * left, rot: turn };
};
const clipFramesOf = (reel: Reel, clip: Clip) => {
  const i = reel.clips.indexOf(clip);
  return clipStarts(reel)[i].frames + tailFrames(reel, i);
};
// Zoom that keeps the frame covered at frame f of a settle move: every frame corner,
// carried back through the move, must land inside the picture. It eases off as the shot
// comes to rest (a camera landing overhead).
export const settleCover = (reel: Reel, clip: Clip, f: number) => {
  const { x, y, rot } = settleAt(reel, clip, f);
  const a = (-rot * Math.PI) / 180;
  let need = 1;
  for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const dx = (px * WIDTH) / 2 - x, dy = (py * HEIGHT) / 2 - y;
    const qx = dx * Math.cos(a) - dy * Math.sin(a), qy = dx * Math.sin(a) + dy * Math.cos(a);
    need = Math.max(need, Math.abs(qx) / (WIDTH / 2), Math.abs(qy) / (HEIGHT / 2));
  }
  return need * 1.005;
};
// Largest zoom the move reaches (the no-upscale check uses it).
export const settleScale = (reel: Reel, clip: Clip) => {
  if (!clip.settle) return 1;
  let need = 1;
  for (let f = 0; f <= clipFramesOf(reel, clip); f++) need = Math.max(need, settleCover(reel, clip, f));
  return need;
};
