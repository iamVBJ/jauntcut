import React, { useId } from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Clip, Motion, Reel } from "./schema";
import { anton } from "./fonts";
import { FPS, MOTION_MAX_SCALE, PUSH_INTO_LINEAR, PUSH_INTO_SCALE, beatFrame, derivedPath, maskPath, playPath, trackKey, freezeFrame, freezePath, hasCurve, isVideo, needsDerive, paintPath, preparedPath, settleAt, settleCover, sketchPath, depthSlicePath, speedAt, transitionFrames, transitionOf } from "./lib";

const PAN = 0.035;

const motionTransform = (motion: Motion, p: number) => {
  const s = MOTION_MAX_SCALE;
  const lerp = (a: number, b: number) => interpolate(p, [0, 1], [a, b]);
  switch (motion) {
    case "still":
      return "none";
    case "push-in":
      return `scale(${lerp(1, s)})`;
    case "push-into":
      // p is linear here: moving from the first frame, accelerating to the end
      return `scale(${Math.pow(PUSH_INTO_SCALE, PUSH_INTO_LINEAR * p + (1 - PUSH_INTO_LINEAR) * p * p)})`;
    case "pull-out":
      return `scale(${lerp(s, 1)})`;
    case "pan-left":
      return `scale(${s}) translateX(${lerp(PAN, -PAN) * 100}%)`;
    case "pan-right":
      return `scale(${s}) translateX(${lerp(-PAN, PAN) * 100}%)`;
    case "pan-up":
      return `scale(${s}) translateY(${lerp(PAN, -PAN) * 100}%)`;
    case "pan-down":
      return `scale(${s}) translateY(${lerp(-PAN, PAN) * 100}%)`;
  }
};

// Photo arriving in motion and coming to rest (clip.settle), zoomed just enough to stay covered.
const settleTransform = (reel: Reel, clip: Clip, f: number) => {
  const { x, y, rot } = settleAt(reel, clip, f);
  return `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${settleCover(reel, clip, f)})`;
};

// Letters standing on a ground line (x = centre, y = bottom of the letters, in px): they
// rise out of the ground one after another and, from `sinkAt`, sink back into it.
const SCENE_TEXT = "#F4F0E8";
const RisingText: React.FC<{ text: string; x: number; y: number; size: number; rise: number; sinkAt?: number; color?: string; shadow?: string }> = ({
  text, x, y, size, rise, sinkAt, color = SCENE_TEXT, shadow,
}) => {
  const f = useCurrentFrame();
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;
  const sinkEase = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.7, 0, 0.84, 0) } as const;
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, transform: "translate(-50%, -100%)", overflow: "hidden",
        display: "flex", fontFamily: anton, fontSize: size, lineHeight: 1, color, textShadow: shadow, whiteSpace: "pre",
        // Anton at line-height 1: letters run 0.056-0.92 em from the top (measured), so
        // this box's bottom edge sits on the letters' bottom: they rise out of the ground.
        paddingTop: size * 0.1, height: size * 1.025, alignItems: "flex-start",
      }}
    >
      {text.split("").map((ch, i) => {
        const up = interpolate(f, [rise + i * 1.6, rise + i * 1.6 + 16], [0, 1], ease);
        const down = sinkAt === undefined ? 0 : interpolate(f, [sinkAt + i * 1.2, sinkAt + i * 1.2 + 12], [0, 1], sinkEase);
        return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - up + down) * 105}%)` }}>{ch}</span>;
      })}
    </div>
  );
};

// 2.5D parallax: the subject (Vision cutout) on its own layer grows a little faster than
// the photo behind it, anchored at its base, so a still reads as a camera moving past
// something in front. The original subject stays underneath, so no hole opens up.
const Parallax: React.FC<{ reel: Reel; clip: Clip; style: React.CSSProperties; src: string; frames: number }> = ({ reel, clip, style, src, frames }) => {
  const f = useCurrentFrame();
  const p = clip.parallax!;
  const k = interpolate(f, [0, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: reel.photoMoves === "continuous" ? undefined : Easing.bezier(0.25, 0.1, 0.35, 1) });
  const mask = `url(${staticFile(maskPath(reel, clip))})`;
  return (
    <>
      <Img src={src} style={style} />
      <AbsoluteFill style={{ transform: `scale(${1 + p.amount * k})`, transformOrigin: `${p.x * 100}% ${p.y * 100}%` }}>
        <Img
          src={src}
          style={{ ...style, maskImage: mask, WebkitMaskImage: mask, maskSize: "cover", WebkitMaskSize: "cover",
            maskPosition: style.objectPosition as string, WebkitMaskPosition: style.objectPosition as string, maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat",
            filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.18))" }}
        />
      </AbsoluteFill>
    </>
  );
};

// Sketch transition (photos): the shot is drawn, then painted. Paper fades in over the
// previous shot while a pencil sketch of this photo (scripts/sketch.py) draws itself,
// strongest lines first; then the colour blooms in like a watercolour wash, outward from
// the focal point with soft, uneven edges (a noise field, generated in the filter); the
// pencil lines lift off as the paint dries. The bloom is mostly radial (one spreading
// wash), the noise only roughens its edge: a noise-led wash left dark islands like stains. Same transforms as the photo, so it all lines up.
const PAPER = "#F2EDE3";
const SketchIn: React.FC<{ reel: Reel; clip: Clip; style: React.CSSProperties; src: string }> = ({ reel, clip, style, src }) => {
  const f = useCurrentFrame();
  const n = transitionFrames(clip);
  const id = `sk${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const sketch = staticFile(sketchPath(reel, clip));
  if (f >= n) return <Img src={src} style={style} />;
  const p = f / n;
  const c = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const paper = interpolate(p, [0, 0.2], [0, 1], { ...c, easing: Easing.out(Easing.quad) });
  // Pencil: lines appear strongest first (alpha threshold falls from 1 to 0).
  const draw = interpolate(p, [0, 0.42], [0.12, 1], { ...c, easing: Easing.out(Easing.cubic) });
  const lw = 0.25;
  // Paint: the wash front moves through the order map (0 = paints first).
  const ww = 0.2;
  const wash = interpolate(p, [0.3, 1], [-ww, 1 + ww], { ...c, easing: Easing.inOut(Easing.sin) });
  const lift = interpolate(p, [0.72, 1], [1, 0], c);
  const fx = clip.focal.x * 1080, fy = clip.focal.y * 1920;
  const radial = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><radialGradient id="r" gradientUnits="userSpaceOnUse" cx="${fx}" cy="${fy}" r="1250"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient></defs><rect width="1080" height="1920" fill="url(#r)"/></svg>`,
  )}`;
  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={`${id}d`} colorInterpolationFilters="sRGB">
          <feComponentTransfer in="SourceAlpha" result="m">
            <feFuncA type="linear" slope={1 / lw} intercept={-(1 - draw) / lw} />
          </feComponentTransfer>
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <filter id={`${id}w`} x="0" y="0" width="1080" height="1920" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0045 0.0038" numOctaves="3" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="2.4 0 0 0 -0.7  2.4 0 0 0 -0.7  2.4 0 0 0 -0.7  0 0 0 0 1" result="n2" />
          <feImage href={radial} x="0" y="0" width="1080" height="1920" preserveAspectRatio="none" result="rad" />
          <feComposite in="rad" in2="n2" operator="arithmetic" k1="0" k2="0.8" k3="0.2" k4="0" result="order" />
          <feColorMatrix in="order" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="oa" />
          <feComponentTransfer in="oa" result="ramp">
            <feFuncA type="linear" slope={-1 / ww} intercept={wash / ww} />
          </feComponentTransfer>
          <feGaussianBlur in="ramp" stdDeviation="6" result="matte" />
          <feComposite in="SourceGraphic" in2="matte" operator="in" />
        </filter>
      </svg>
      <AbsoluteFill style={{ backgroundColor: PAPER, opacity: paper }} />
      <AbsoluteFill style={{ filter: `url(#${id}w)` }}>
        <Img src={src} style={style} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: paper * lift, filter: `url(#${id}d)` }}>
        <Img src={sketch} style={style} />
      </AbsoluteFill>
    </>
  );
};

// Glaze transition (painted ceramics): the shot arrives unpainted, like white bisque
// (grey, pale, flat), then colour is dabbed on piece by piece: soft, slightly ragged
// round dabs, about one piece wide, in a jittered grid over the glaze area, landing one
// after another in a scattered order like brush touches; finally the rest colours in.
const GlazeIn: React.FC<{ clip: Clip; style: React.CSSProperties; src: string }> = ({ clip, style, src }) => {
  const f = useCurrentFrame();
  const n = transitionFrames(clip);
  if (f >= n) return <Img src={src} style={style} />;
  const p = f / n;
  const g = clip.glaze ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const W = 1080, H = 1920;
  const r = 0.05 * W;
  const cols = Math.max(2, Math.round(((g.x1 - g.x0) * W) / (r * 1.5)));
  const rows = Math.max(2, Math.round(((g.y1 - g.y0) * H) / (r * 1.5)));
  // Deterministic pseudo-random jitter and order.
  const rnd = (k: number) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const dabs: string[] = [];
  const N = cols * rows;
  for (let k = 0; k < N; k++) {
    const i = k % cols, j = Math.floor(k / cols);
    const cx = (g.x0 + ((i + 0.5 + (rnd(k) - 0.5) * 0.5) / cols) * (g.x1 - g.x0)) * W;
    const cy = (g.y0 + ((j + 0.5 + (rnd(k + 99) - 0.5) * 0.5) / rows) * (g.y1 - g.y0)) * H;
    const start = 0.04 + rnd(k + 7) * 0.5; // when this dab lands (fraction of n)
    const grow = interpolate(p, [start, start + 0.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    if (grow > 0) dabs.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * (0.6 + 0.4 * grow) * (0.85 + rnd(k + 3) * 0.3)).toFixed(1)}" fill="url(#d)" opacity="${grow.toFixed(3)}"/>`);
  }
  const rest = interpolate(p, [0.55, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="d"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="18"/></filter></defs><rect width="${W}" height="${H}" fill="#fff" opacity="${rest.toFixed(3)}"/><g filter="url(#rough)">${dabs.join("")}</g></svg>`;
  const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  return (
    <>
      <Img src={src} style={{ ...style, filter: "grayscale(1) sepia(0.12) brightness(1.16) contrast(0.8)" }} />
      <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }}>
        <Img src={src} style={style} />
      </AbsoluteFill>
    </>
  );
};

// 2.5D camera move from a depth map: the photo, then the same photo masked to everything
// nearer than each depth threshold, stacked far to near; every slice pushes in toward
// (x, y) at constant speed, nearer slices further, so near things slide past faster than
// the background, like a slider shot. A nearer slice only ever grows over the ones behind
// it on a push-in, so no holes open up.
const Depth3D: React.FC<{ reel: Reel; clip: Clip; style: React.CSSProperties; src: string; frames: number }> = ({ reel, clip, style, src, frames }) => {
  const f = useCurrentFrame();
  const d = clip.depth3d!;
  const t = interpolate(f, [0, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const L = d.layers;
  const layer = (k: number) => {
    const s = 1 + (d.base + ((d.amount - d.base) * k) / (L - 1)) * t;
    return { transform: `scale(${s})`, transformOrigin: `${d.x * 100}% ${d.y * 100}%` };
  };
  // Rack focus: the focus plane moves from `from` to `to`, eased in and out as a focus
  // puller turns the ring. The slices are spaced evenly in disparity (depth_slices.py): the
  // photo is the far plane (0) and slice k holds depths (k-1)/(L-2) to k/(L-2), so it sits at
  // the middle of that band; its blur is proportional to its distance from the plane.
  // The blur is on a wrapper outside the mask, so a soft layer's edge spreads over what is
  // behind it as an out-of-focus edge does.
  const r = d.rack;
  const focus = r ? interpolate(t, [r.start, r.end], [r.from, r.to], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const blur = (k: number) => (r ? { filter: `blur(${(r.blur * Math.abs((k === 0 ? 0 : (k - 0.5) / (L - 2)) - focus)).toFixed(2)}px)` } : {});
  return (
    <>
      {/* A blurred layer fades to transparent at the frame's edges: the sharp photo under
          it fills that thin rim instead of the black background. */}
      {r ? <AbsoluteFill style={layer(0)}><Img src={src} style={style} /></AbsoluteFill> : null}
      <AbsoluteFill style={layer(0)}>
        <AbsoluteFill style={blur(0)}>
          <Img src={src} style={style} />
        </AbsoluteFill>
      </AbsoluteFill>
      {Array.from({ length: L - 1 }, (_, i) => {
        const mask = `url(${staticFile(depthSlicePath(reel, clip, i + 1))})`;
        return (
          <AbsoluteFill key={i} style={layer(i + 1)}>
            <AbsoluteFill style={blur(i + 1)}>
              <Img src={src} style={{ ...style, position: "absolute", inset: 0, WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }} />
            </AbsoluteFill>
          </AbsoluteFill>
        );
      })}
    </>
  );
};

// A title standing in a photo behind its subject: the photo, the title, then the photo
// again cut to the subject (Vision mask) on top, so the subject stays in front.
// The clip's grade filter, for layers that grade their own pieces (BehindTitle grades the
// photo and leaves its title out, so the title keeps its exact colour).
const GradeFilter = React.createContext<string | undefined>(undefined);

const BehindTitle: React.FC<{ reel: Reel; clip: Clip; style: React.CSSProperties; src: string }> = ({ reel, clip, style: base, src }) => {
  const b = clip.behind!;
  const style = { ...base, filter: React.useContext(GradeFilter) };
  const mask = `url(${staticFile(maskPath(reel, clip))})`;
  return (
    <>
      <Img src={src} style={style} />
      <RisingText text={b.text} x={b.x * 1080} y={b.y * 1920} size={b.size} rise={beatFrame(reel, b.riseAtBeat)} color={b.color}
        shadow={b.shadow ?? (b.color === SCENE_TEXT ? undefined : "0 2px 10px rgba(0,0,0,0.45)")} />
      <Img
        src={src}
        style={{ ...style, position: "absolute", inset: 0, maskImage: mask, WebkitMaskImage: mask, maskSize: "cover", WebkitMaskSize: "cover",
          maskPosition: style.objectPosition as string, WebkitMaskPosition: style.objectPosition as string, maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }}
      />
    </>
  );
};

// Text placed in the scene: follows the background (motion track), letters rise out of
// the ground line one after another, and the subject cutout goes back on top, so a kart
// passing close drives in front of the words.
export const sceneTrack = (reel: Reel, clip: Clip, frames: number) => {
  const tr = reel.tracks[trackKey(clip, frames)];
  if (!tr) throw new Error(`no motion track for ${clip.src}: run npm run derive ${reel.slug}`);
  return tr;
};
export const cutoutSrc = (reel: Reel, clip: Clip, frames: number, c: number) =>
  staticFile(`${reel.slug}/derived/${trackKey(clip, frames)}/cut_${c}.png`);

const SceneText: React.FC<{ reel: Reel; clip: Clip; frames: number }> = ({ reel, clip, frames }) => {
  const f = useCurrentFrame();
  const smearId = `smear${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const sc = clip.scene!;
  const tr = sceneTrack(reel, clip, frames);
  const at = (n: number) => tr.frames[Math.max(0, Math.min(tr.frames.length - 1, n))];
  const cur = at(f);
  const ref = at(beatFrame(reel, sc.atBeat));
  const x = sc.x * 1080 + sc.followX * (cur.dx - ref.dx);
  const y = sc.y * 1920 + cur.dy - ref.dy;
  const text = (
    <RisingText text={sc.text} x={x} y={y} size={sc.size} rise={beatFrame(reel, sc.riseAtBeat)}
      sinkAt={sc.sinkAtBeat === undefined ? undefined : beatFrame(reel, sc.sinkAtBeat)} />
  );
  const cutout = <Img src={cutoutSrc(reel, clip, frames, cur.c)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
  if (!sc.erase) return <>{text}{cutout}</>;

  // Erase: the subject's trailing edge sweeps the letters away. Only a subject crossing
  // the letters' band counts (not scenery Vision picked up elsewhere in the frame).
  const bandTop = y - sc.size * 0.92;
  const crosses = (b: number[] | null) => !!b && Math.min(b[3], y) - Math.max(b[1], bandTop) > 0.3 * (y - bandTop);
  const hits = tr.frames.map((fr, i) => (crosses(fr.box) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return <>{text}{cutout}</>;
  const first = hits[0];
  const last = hits[hits.length - 1];
  const mid = (i: number) => (tr.frames[i].box![0] + tr.frames[i].box![2]) / 2;
  const left = mid(last) < mid(first); // travelling right-to-left
  const INSET = 70; // the edge sits inside the subject's body, hidden behind it
  let edge = left ? Infinity : -Infinity;
  for (const i of hits) {
    if (i > f) break;
    const b = tr.frames[i].box!;
    edge = left ? Math.min(edge, b[2] - INSET) : Math.max(edge, b[0] + INSET);
  }
  const gone = f > last;
  if (gone) edge = left ? -Infinity : Infinity;
  const F = 40;
  const e = Math.max(-2000, Math.min(3000, edge));
  const keep = left
    ? `linear-gradient(90deg, black ${e - F}px, transparent ${e + F}px)`
    : `linear-gradient(90deg, transparent ${e - F}px, black ${e + F}px)`;
  // The wake: what was erased, smeared along the direction of travel and fading out.
  const fade = gone ? interpolate(f, [last, last + 12], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const trailEdge = gone ? (left ? tr.frames[last].box![2] - INSET : tr.frames[last].box![0] + INSET) : e;
  const wake = left
    ? `linear-gradient(90deg, transparent ${trailEdge - F}px, rgba(0,0,0,0.55) ${trailEdge + F}px, transparent ${trailEdge + 320}px)`
    : `linear-gradient(90deg, transparent ${trailEdge - 320}px, rgba(0,0,0,0.55) ${trailEdge - F}px, transparent ${trailEdge + F}px)`;
  const started = f >= first;
  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={smearId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="26 1.5" />
        </filter>
      </svg>
      <AbsoluteFill style={{ maskImage: keep, WebkitMaskImage: keep }}>{text}</AbsoluteFill>
      {started && fade > 0 && (
        <AbsoluteFill style={{ maskImage: wake, WebkitMaskImage: wake, opacity: fade }}>
          <AbsoluteFill style={{ transform: `translateX(${left ? -46 : 46}px)`, filter: `url(#${smearId})` }}>{text}</AbsoluteFill>
        </AbsoluteFill>
      )}
      {cutout}
    </>
  );
};

const Source: React.FC<{ reel: Reel; clip: Clip; frames: number }> = (props) => {
  const { reel, clip } = props;
  if (!clip.freeze || !isVideo(clip.src)) return <Playing {...props} />;
  const at = freezeFrame(reel, clip);
  return (
    <>
      <Sequence durationInFrames={at}>
        <Playing {...props} />
      </Sequence>
      <Sequence from={at}>
        <Img src={staticFile(freezePath(reel, clip))} style={coverStyle(clip)} />
      </Sequence>
    </>
  );
};

const coverStyle = (clip: Clip): React.CSSProperties => ({
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: `${clip.focal.x * 100}% ${clip.focal.y * 100}%`,
});

const Playing: React.FC<{ reel: Reel; clip: Clip; frames: number }> = ({ reel, clip, frames }) => {
  const src = staticFile(isVideo(clip.src) ? playPath(reel, clip) : clip.paint > 0 ? paintPath(reel, clip) : preparedPath(reel.slug, clip.src));
  // Reframe: the crop glides across a wider-than-9:16 frame at constant speed (no ease to
  // a stop before the cut), e.g. along a GoPro horizon to reveal the landscape.
  const local = useCurrentFrame();
  const fx = clip.reframe ? interpolate(local, [0, frames], [clip.reframe.x0, clip.reframe.x1], { extrapolateLeft: "clamp", extrapolateRight: "extend" }) : clip.focal.x;
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${Math.min(1, Math.max(0, fx)) * 100}% ${clip.focal.y * 100}%`,
  };
  const sound = clip.sound > 0 ? { muted: false, volume: clip.sound } : { muted: true };
  if (isVideo(clip.src) && needsDerive(clip)) {
    // Pre-rendered by `npm run derive`: already trimmed (and slowed, if smooth) and
    // reversed/stabilised. Derived files carry no sound.
    return (
      <OffthreadVideo
        src={staticFile(derivedPath(reel, clip, frames))}
        muted
        trimBefore={0}
        playbackRate={clip.smooth ? 1 : clip.speed}
        style={style}
      />
    );
  }
  if (!isVideo(clip.src)) {
    if (clip.behind) return <BehindTitle reel={reel} clip={clip} style={style} src={src} />;
    if (clip.parallax) return <Parallax reel={reel} clip={clip} style={style} src={src} frames={frames} />;
    if (clip.depth3d) return <Depth3D reel={reel} clip={clip} style={style} src={src} frames={frames} />;
    if (transitionOf(clip) === "sketch") return <SketchIn reel={reel} clip={clip} style={style} src={src} />;
    if (transitionOf(clip) === "glaze") return <GlazeIn clip={clip} style={style} src={src} />;
    return <Img src={src} style={style} />;
  }
  // trimBefore is the source frame to start at (verified exactly by `npm run timing-test`).
  const trim = (sourceFrame: number, _rate: number) => Math.round(sourceFrame);
  const start = clip.startAt * FPS;
  if (hasCurve(clip)) {
    // Speed curve: constant stretches play as one piece; where the speed changes, 2-frame
    // pieces, each starting exactly where the source has got to and playing at its
    // average speed, so the curve is followed without jumps.
    const end = clip.freeze ? Math.min(frames, freezeFrame(reel, clip)) : frames;
    const pieces: React.ReactNode[] = [];
    let s = 0;
    let off = 0;
    while (s < end) {
      const v0 = speedAt(reel, clip, s + 0.5, frames);
      let len = 1;
      while (s + len < end && Math.abs(speedAt(reel, clip, s + len + 0.5, frames) - v0) < 1e-9) len++;
      if (len === 1) len = Math.min(2, end - s);
      let sum = 0;
      for (let k = 0; k < len; k++) sum += speedAt(reel, clip, s + k + 0.5, frames);
      pieces.push(
        <Sequence key={s} from={s} durationInFrames={len}>
          <OffthreadVideo src={src} {...sound} trimBefore={Math.round(start + off * FPS)} playbackRate={sum / len} style={style} />
        </Sequence>,
      );
      off += sum / FPS;
      s += len;
    }
    return <>{pieces}</>;
  }
  if (!clip.ramp)
    return <OffthreadVideo src={src} {...sound} trimBefore={trim(start, clip.speed)} playbackRate={clip.speed} style={style} />;
  // Speed ramp: switch rate at a beat, continuing from the same source moment.
  const at = beatFrame(reel, clip.ramp.atBeat);
  return (
    <>
      <Sequence durationInFrames={at}>
        <OffthreadVideo src={src} {...sound} trimBefore={trim(start, clip.speed)} playbackRate={clip.speed} style={style} />
      </Sequence>
      <Sequence from={at}>
        <OffthreadVideo
          src={src}
          {...sound}
          trimBefore={trim(start + at * clip.speed, clip.ramp.speed)}
          playbackRate={clip.ramp.speed}
          style={style}
        />
      </Sequence>
    </>
  );
};

export const Media: React.FC<{ reel: Reel; clip: Clip; motion: Motion; frames: number }> = ({
  reel,
  clip,
  motion,
  frames,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, frames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: reel.photoMoves === "continuous" ? undefined : Easing.bezier(0.25, 0.1, 0.35, 1),
  });
  const linear = interpolate(frame, [0, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const grade = gradeFor(reel, clip, `wb${id}`);
  return (
    // A sketch transition shows the previous shot under the paper as it fades in: no black.
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: transitionOf(clip) === "sketch" ? undefined : "#000" }}>
      {grade.svg}
      <AbsoluteFill
        style={{ transform: `scale(${clip.zoom})`, transformOrigin: `${clip.focal.x * 100}% ${clip.focal.y * 100}%` }}
      >
        <AbsoluteFill
          style={{
            transform: clip.settle ? settleTransform(reel, clip, frame) : motionTransform(motion, motion === "push-into" ? linear : p),
            transformOrigin: motion === "push-into" ? `${clip.focal.x * 100}% ${clip.focal.y * 100}%` : undefined,
            // A behind-title clip grades its photo layers itself (GradeFilter), not the title.
            filter: clip.behind ? undefined : grade.filter,
          }}
        >
          <GradeFilter.Provider value={grade.filter}>
          <Source reel={reel} clip={clip} frames={frames} />
          {clip.scene && <SceneText reel={reel} clip={clip} frames={frames} />}
          </GradeFilter.Provider>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// The reel's grade with this clip's adjustments on top. With no exposure /
// temperature / tint the CSS is exactly the original, so existing reels don't change.
export const gradeFor = (reel: Reel, clip: Clip, id: string): { filter?: string; svg: React.ReactNode } => {
  if (clip.grade === "none") return { filter: undefined, svg: null };
  const g = reel.grade;
  const c = clip.grade ?? {};
  const contrast = c.contrast ?? g.contrast;
  const saturation = c.saturation ?? g.saturation;
  const warmth = c.warmth ?? g.warmth;
  const exposure = g.exposure + (c.exposure ?? 0);
  const temperature = g.temperature + (c.temperature ?? 0);
  const tint = g.tint + (c.tint ?? 0);
  let filter = `contrast(${contrast}) saturate(${saturation}) sepia(${warmth})`;
  if (exposure !== 0) filter += ` brightness(${(2 ** exposure).toFixed(4)})`;
  const film = g.film;
  if (temperature === 0 && tint === 0 && !film) return { filter, svg: null };
  // White balance as channel gains: warmer = more red, less blue; + tint = magenta.
  const r = 1 + 0.15 * temperature + 0.05 * tint;
  const gg = 1 - 0.1 * tint;
  const b = 1 - 0.15 * temperature + 0.05 * tint;
  filter += ` url(#${id})`;
  const svg = (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        {(temperature !== 0 || tint !== 0) && <feColorMatrix type="matrix" values={`${r} 0 0 0 0  0 ${gg} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`} />}
        {film && (
          <feComponentTransfer>
            <feFuncR type="table" tableValues={filmCurve(film, 0)} />
            <feFuncG type="table" tableValues={filmCurve(film, 1)} />
            <feFuncB type="table" tableValues={filmCurve(film, 2)} />
          </feComponentTransfer>
        )}
      </filter>
    </svg>
  );
  return { filter, svg };
};

// One channel of the film look as a 33-point curve: an S-curve (blend of linear and
// smoothstep) mapped between the lifted black and the rolled-off white, then split
// toning: shadows pulled toward one colour (weighted by how dark the level is) and the
// upper mids toward another, so skies and clouds keep their own colour.
type Film = { curve: number; fade: number; roll: number; split: number; shadows: string; highlights: string; lift: number; deep: number };
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const filmCurve = (f: Film, ch: number): string => {
  const sh = hexRgb(f.shadows), hi = hexRgb(f.highlights);
  const shMean = (sh[0] + sh[1] + sh[2]) / 3, hiMean = (hi[0] + hi[1] + hi[2]) / 3;
  const out: string[] = [];
  for (let i = 0; i <= 32; i++) {
    const x = i / 32;
    const s = x * x * (3 - 2 * x);
    let y = (1 - f.curve) * x + f.curve * s;
    // Lower-mid lift: peaks at a third of the way up, zero at black and white, so faces
    // in the lower mids come out of the S-curve's shadow and the blacks stay deep.
    y += f.lift * 6.75 * x * (1 - x) * (1 - x);
    y = f.fade + y * (1 - f.fade - f.roll);
    // Warmth sits on the upper mids (skin, the suit), not the brightest whites: warming
    // the top end turned skies and clouds beige.
    const ws = Math.pow(Math.max(0, f.deep - y) / f.deep, 3), wh = Math.exp(-Math.pow((y - 0.58) / 0.2, 2));
    y += f.split * 0.18 * (ws * (sh[ch] - shMean) + wh * (hi[ch] - hiMean));
    out.push(Math.min(1, Math.max(0, y)).toFixed(4));
  }
  return out.join(" ");
};
