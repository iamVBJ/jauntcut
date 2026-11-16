import React from "react";
import {
  AbsoluteFill,
  Easing,
  Html5Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { anton, bodoni, brush, brushSerif, caveat, cormorant, jost, sans, serif } from "./fonts";
import { HtmlInCanvasMotionBlur } from "@remotion/motion-blur";
import type { Reel as ReelProps } from "./schema";
import {
  FPS, PORTAL_INNER, SAFE, beatFrame, isVideo, beatOffsetFrames, bpmOf, clipStarts, hookEndFrame, fr, motionFor, musicStart, tailFrames, textY, totalFrames, transitionFrames, transitionOf,
} from "./lib";
import type { Transition } from "./schema";
import { Media, cutoutSrc, gradeFor, sceneTrack } from "./Media";


const SNAP = { damping: 20, stiffness: 260, mass: 0.7 };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Dir = { dx: number; dy: number };
const whipDir = (i: number): Dir => (i % 2 === 0 ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 });
// transitionDir names the way the picture moves; the whip maths take the opposite sign.
const DIRS: Record<string, Dir> = { right: { dx: -1, dy: 0 }, left: { dx: 1, dy: 0 }, down: { dx: 0, dy: -1 }, up: { dx: 0, dy: 1 } };

// Transition effects either side of a cut. `into` is how this clip arrives, `out`
// how the next one arrives (applied to this clip's last frames before the cut).
// directed: the clip set transitionDir, so the whip uses the gap-free directional version.
type Portal = { x: number; y: number; w: number; h: number; arch?: boolean };
type Fx = { type: Transition; n: number; dir: Dir; directed?: boolean; portal?: Portal; at?: { x: number; y: number } } | null;

// Portal: how far the push goes (the opening must end up covering the whole frame,
// arch corners included) and its pace. The push into the previous shot is already moving
// at the cut and carries on under the portal, so the portal adds to it from zero and
// only ever accelerates: no ease-in pause (it read as a stall) and no lurch at the cut (a
// head start of 0.25 doubled the speed in one frame, measured).
const portalScale = (p: Portal) => 1.3 * Math.max(p.x / (p.w / 2), (1 - p.x) / (p.w / 2), p.y / (p.h / 2), (1 - p.y) / (p.h / 2));
const portalK = (f: number, n: number) => {
  const u = interpolate(f, [0, n], [0, 1], clamp);
  return u * u;
};
type FxStyle = { style: React.CSSProperties; origin?: string; overlay?: { color: string; opacity: number }; opacity?: number; rgb?: number; streak?: { x: number; y: number }; glow?: React.CSSProperties };

const useTransitionFx = (into: Fx, out: Fx, frames: number): FxStyle => {
  const f = useCurrentFrame();
  let x = 0;
  let y = 0;
  let blur = 0;
  let scale = 1;
  let opacity: number | undefined;
  let overlay: FxStyle["overlay"];
  let rgb = 0;
  let streak: FxStyle["streak"];
  const apply = (fx: NonNullable<Fx>, k: number, sign: 1 | -1) => {
    switch (fx.type) {
      case "whip":
        if (fx.directed) {
          // Short slide, zoomed enough that no edge shows, smeared along the move.
          x = sign * fx.dir.dx * k * 12;
          y = sign * fx.dir.dy * k * 12;
          scale = 1 + 0.3 * k;
          streak = { x: Math.abs(fx.dir.dx) * k * 70 + k * 2, y: Math.abs(fx.dir.dy) * k * 70 + k * 2 };
          break;
        }
        // fast directional slide plus blur (original whip, unchanged)
        x = sign * fx.dir.dx * k * 40;
        y = sign * fx.dir.dy * k * 40;
        blur = k * 26;
        scale = 1 + blur / 250;
        break;
      case "zoom": // punch through: scale up out of one shot, settle into the next
        scale = 1 + 0.35 * k;
        blur = 18 * k;
        break;
      case "blur":
        blur = 24 * k;
        break;
      case "glitch": { // colour channels split apart plus a stepped horizontal jitter
        const step = Math.floor(f / 2);
        x = (((step * 7919) % 11) - 5) * 0.6 * k;
        scale = 1 + 0.08 * k; // covers the jitter
        rgb = 28 * k;
        break;
      }
    }
  };
  if (into && into.type !== "cut" && f < into.n) {
    const k = interpolate(f, [0, into.n], [1, 0], clamp) ** 2;
    apply(into, k, 1);
    if (into.type === "dissolve") opacity = interpolate(f, [0, into.n], [0, 1], clamp);
    if (into.type === "dip-black" || into.type === "dip-white") {
      overlay = { color: into.type === "dip-black" ? "#000" : "#fff", opacity: interpolate(f, [0, into.n / 2], [1, 0], clamp) };
    }
  }
  if (out && out.type !== "cut" && out.type !== "dissolve" && f >= frames - out.n) {
    const k = interpolate(f, [frames - out.n, frames], [0, 1], clamp) ** 2;
    apply(out, k, -1);
    if (out.type === "dip-black" || out.type === "dip-white") {
      overlay = { color: out.type === "dip-black" ? "#000" : "#fff", opacity: interpolate(f, [frames - out.n / 2, frames], [0, 1], clamp) };
    }
  }
  // Bloom: the light swells over the last half of the outgoing shot (warm glow growing
  // from the light, the picture brightening and softening) and recedes over the first
  // half of the incoming one, which sharpens out of it.
  const WARM = "255,236,204";
  if (out && out.type === "bloom" && out.at && f >= frames - out.n / 2) {
    const k = interpolate(f, [frames - out.n / 2, frames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
    return {
      style: { filter: `brightness(${1 + 0.9 * k}) blur(${6 * k}px)`, transform: `scale(${1 + 0.04 * k})`, transformOrigin: `${out.at.x * 100}% ${out.at.y * 100}%` },
      glow: { background: `radial-gradient(circle at ${out.at.x * 100}% ${out.at.y * 100}%, rgba(${WARM},${k}) ${10 + 90 * k}%, rgba(${WARM},${k * k}) ${40 + 160 * k}%)` },
    };
  }
  if (into && into.type === "bloom" && f < into.n / 2) {
    const k = interpolate(f, [0, into.n / 2], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
    return {
      style: { filter: `brightness(${1 + 0.6 * k}) blur(${5 * k}px)`, transform: `scale(${1 + 0.05 * k})` },
      glow: { background: `rgba(${WARM},${k})` },
    };
  }
  // Portal, outgoing side: after the cut (in this clip's tail) push in on the opening.
  if (out && out.type === "portal" && out.portal && f >= frames) {
    const s = Math.pow(portalScale(out.portal), portalK(f - frames, out.n));
    return { style: { transform: `scale(${s})`, transformOrigin: `${out.portal.x * 100}% ${out.portal.y * 100}%` } };
  }
  const style: React.CSSProperties =
    blur > 0.1 || scale !== 1 || x !== 0
      ? { transform: `translate(${x}%, ${y}%) scale(${scale})`, filter: blur > 0.1 ? `blur(${blur}px)` : undefined }
      : {};
  return { style, overlay, opacity, rgb, streak };
};

// Directional motion blur (whip streak) and/or red-blue split by `px` (glitch).
const FxFilter: React.FC<{ id: string; px: number; streak?: { x: number; y: number } }> = ({ id, px, streak }) => (
  <svg width="0" height="0" style={{ position: "absolute" }}>
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      {streak && <feGaussianBlur in="SourceGraphic" stdDeviation={`${streak.x} ${streak.y}`} edgeMode="duplicate" result="src" />}
      {!streak && <feOffset in="SourceGraphic" dx={0} result="src" />}
      {px === 0 && <feOffset in="src" dx={0} />}
      {px !== 0 && <feColorMatrix in="src" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />}
      {px !== 0 && <feOffset in="r" dx={px} result="r2" />}
      {px !== 0 && <feColorMatrix in="src" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />}
      {px !== 0 && <feColorMatrix in="src" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />}
      {px !== 0 && <feOffset in="b" dx={-px} result="b2" />}
      {px !== 0 && <feBlend in="r2" in2="g" mode="screen" result="rg" />}
      {px !== 0 && <feBlend in="rg" in2="b2" mode="screen" />}
    </filter>
  </svg>
);

// Beat pulse (zoom punch on each beat) and an impact shake that settles.
const useCameraFx = (reel: ReelProps, clip: ReelProps["clips"][number], from: number): React.CSSProperties => {
  const f = useCurrentFrame();
  if (!clip.pulse && !clip.shake && !clip.freeze) return {};
  const beat = (60 * FPS) / bpmOf(reel);
  let scale = 1;
  let x = 0;
  let y = 0;
  let rot = 0;
  if (clip.pulse) {
    const phase = (((from + f - beatOffsetFrames(reel)) / beat) % 1 + 1) % 1;
    scale += clip.pulse * Math.exp(-phase * 7);
  }
  if (clip.shake) {
    const t = f - clip.shakeAtBeat * beat;
    if (t >= 0) {
      const env = clip.shake * Math.exp(-t / (0.3 * FPS));
      x = env * 1.4 * Math.sin(t * 1.7);
      y = env * 1.0 * Math.sin(t * 2.3 + 1);
      rot = env * 0.5 * Math.sin(t * 1.3 + 2);
      scale += 0.03 * env; // keeps the edges covered while it moves
    }
  }
  if (clip.freeze) {
    // Slow push-in on the frozen picture.
    const at = beatFrame(reel, clip.freeze.atBeat);
    scale *= interpolate(f, [at, at + fr(30)], [1, 1.06], { ...clamp, easing: (t) => 1 - (1 - t) ** 2 });
  }
  return { transform: `translate(${x}%, ${y}%) rotate(${rot}deg) scale(${scale})` };
};

// Subject wipe: this clip opens up behind the previous clip's moving subject, from the
// side it is leaving, and the subject (its cutout) stays on top until it is gone.
const SubjectWipe: React.FC<{ reel: ReelProps; index: number; offset: number; n: number; children: React.ReactNode }> = ({
  reel, index, offset, n, children,
}) => {
  const f = useCurrentFrame();
  const id = `wipe${React.useId().replace(/:/g, "")}`;
  if (f >= n) return <>{children}</>;
  const prev = reel.clips[index - 1];
  const starts = clipStarts(reel);
  const prevFrames = starts[index - 1].frames + tailFrames(reel, index - 1);
  const tr = sceneTrack(reel, prev, prevFrames);
  const boxes = tr.frames.map((x) => x.box);
  const first = boxes.findIndex(Boolean);
  const last = boxes.length - 1 - [...boxes].reverse().findIndex(Boolean);
  const k = Math.min(boxes.length - 1, offset + f);
  // Which way the subject travels over the transition decides the open side.
  const sub = boxes.slice(offset, offset + n).filter(Boolean) as number[][];
  const left = sub.length < 2 || (sub[sub.length - 1][0] + sub[sub.length - 1][2]) < (sub[0][0] + sub[0][2]);
  const b = boxes[k];
  const edge = b ? (left ? b[2] - 40 : b[0] + 40) : first < 0 || k < first ? (left ? 1080 : 0) : k > last ? (left ? 0 : 1080) : left ? 0 : 1080;
  const F = 50;
  const mask = left
    ? `linear-gradient(90deg, transparent ${edge - F}px, black ${edge + F}px)`
    : `linear-gradient(90deg, black ${edge - F}px, transparent ${edge + F}px)`;
  const grade = gradeFor(reel, prev, id);
  return (
    <>
      <AbsoluteFill style={{ maskImage: mask, WebkitMaskImage: mask }}>{children}</AbsoluteFill>
      {grade.svg}
      <AbsoluteFill style={{ filter: grade.filter }}>
        <Img src={cutoutSrc(reel, prev, prevFrames, tr.frames[k].c)} style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
    </>
  );
};

// Graphic-match dissolve, incoming side: this shot starts scaled and shifted so its shape
// (to) sits exactly on the previous shot's shape (from), fades in over the first part,
// and glides on to its own framing. The start scale is raised if needed so the moved
// picture always covers the frame (no black edge).
const MatchIn: React.FC<{ match: { from: { x: number; y: number; r: number }; to: { x: number; y: number; r: number } }; n: number; children: React.ReactNode }> = ({
  match: m, n, children,
}) => {
  const f = useCurrentFrame();
  if (f >= n) return <>{children}</>;
  const dx = m.from.x - m.to.x, dy = m.from.y - m.to.y; // frame fractions
  // Smallest scale about `to` that, after the shift, still covers [0,1] on both axes.
  const need = Math.max(
    (m.to.x + dx) / m.to.x || 0, (1 - m.to.x - dx) / (1 - m.to.x) || 0,
    (m.to.y + dy) / m.to.y || 0, (1 - m.to.y - dy) / (1 - m.to.y) || 0,
  );
  const s0 = Math.max(m.from.r / m.to.r, need, 1);
  // The shapes stay locked together while the pictures cross (first half), then the new
  // shot glides to its own framing.
  const e = interpolate(f, [n * 0.45, n], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.25, 1) });
  const s = s0 + (1 - s0) * e;
  const fade = interpolate(f, [0, n * 0.5], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill style={{ transformOrigin: `${m.to.x * 100}% ${m.to.y * 100}%`, transform: `translate(${dx * (1 - e) * 1080}px, ${dy * (1 - e) * 1920}px) scale(${s})` }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Light-order dissolve, outgoing side: during its tail this shot is drawn above the next
// one and loses its pixels in order of brightness: a threshold sweeps from white to black
// through a soft ramp, so highlights open onto the next shot first and shadows go last.
const LumaOut: React.FC<{ frames: number; n: number; children: React.ReactNode }> = ({ frames, n, children }) => {
  const f = useCurrentFrame();
  const id = `luma${React.useId().replace(/:/g, "")}`;
  if (f < frames) return <>{children}</>;
  // A wide, soft ramp and a blurred matte: light floods smoothly instead of in patches.
  const w = 0.5; // softness of the ramp, in luminance
  const t = interpolate(f, [frames, frames + n], [1 + w, -w], { ...clamp, easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill style={{ zIndex: 1 }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0" result="lum" />
          <feComponentTransfer in="lum" result="ramp">
            <feFuncA type="linear" slope={-1 / w} intercept={t / w} />
          </feComponentTransfer>
          <feGaussianBlur in="ramp" stdDeviation="14" result="matte" />
          <feComposite in="SourceGraphic" in2="matte" operator="in" />
        </filter>
      </svg>
      <AbsoluteFill style={{ filter: `url(#${id})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// Ripple, incoming side: this shot spreads out from a point behind a soft circular
// wavefront; a band of concentric rings rides the front and bends the picture there
// (an SVG displacement map redrawn every frame), easing off as it reaches the edges.
const RippleIn: React.FC<{ at: { x: number; y: number }; n: number; children: React.ReactNode }> = ({ at, n, children }) => {
  const f = useCurrentFrame();
  const id = `ripple${React.useId().replace(/:/g, "")}`;
  if (f >= n) return <>{children}</>;
  const W = 1080, H = 1920;
  const cx = at.x * W, cy = at.y * H;
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
  const k = interpolate(f, [0, n], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const R = k * (far + 220);
  const band = 230;
  // Concentric rings only around the wavefront: a smooth sine (3 ripples) under a smooth
  // envelope, grey (no shift) everywhere else, so the edge bends like water, never tears.
  const stops: string[] = [];
  const g = (o: number, v: number) => stops.push(`<stop offset="${Math.max(0, Math.min(1, o)).toFixed(5)}" stop-color="rgb(${Math.round(v)},${Math.round(v)},${Math.round(v)})"/>`);
  const Rmax = far + 500;
  g(0, 128);
  for (let i = 0; i <= 48; i++) {
    const d = -band + (2 * band * i) / 48;
    const env = Math.cos((Math.PI / 2) * (d / band)) ** 2;
    g((R + d) / Rmax, 128 + 70 * env * Math.sin((d / band) * 3 * Math.PI));
  }
  g(1, 128);
  const map = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="${cx}" cy="${cy}" r="${Rmax}" gradientUnits="userSpaceOnUse">${stops.join("")}</radialGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`,
  )}`;
  const amp = 30 * (1 - k);
  const mask = `radial-gradient(circle at ${cx}px ${cy}px, black ${Math.max(0, R - 130)}px, transparent ${R + 110}px)`;
  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} x="0" y="0" width={W} height={H} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feImage href={map} x="0" y="0" width={W} height={H} preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={amp} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <AbsoluteFill style={{ maskImage: mask, WebkitMaskImage: mask, filter: `url(#${id})` }}>{children}</AbsoluteFill>
    </>
  );
};

// Portal, incoming side: the next shot fades in inside the opening (soft-edged, so the
// door dissolves into what is beyond it instead of a picture snapping in), and the
// opening grows exactly as the previous shot is pushed into. Inside, the shot keeps
// moving forward, decelerating into its own move: no stop and no reverse zoom at the end
// (a settle from closer read as a jump).
const PortalIn: React.FC<{ portal: Portal; n: number; children: React.ReactNode }> = ({ portal: p, n, children }) => {
  const f = useCurrentFrame();
  const u = interpolate(f, [0, n], [0, 1], clamp);
  const inner = Math.pow(PORTAL_INNER, 1 - (1 - u) * (1 - u));
  const moved = (
    <AbsoluteFill style={{ transform: `scale(${inner})`, transformOrigin: `${p.x * 100}% ${p.y * 100}%` }}>{children}</AbsoluteFill>
  );
  if (f >= n) return moved;
  const s = Math.pow(portalScale(p), portalK(f, n));
  const W = 1080, H = 1920;
  const w = p.w * s * W, h = p.h * s * H;
  const left = p.x * W - w / 2, top = p.y * H - h / 2;
  const r = p.arch === false ? 0 : w / 2; // semicircular arch over the opening, or square
  const feather = Math.min(0.05 * w, 20);
  // The arch's top corners only clear the frame's corners at the very end: the rest of the
  // frame dissolves in over the last third so no sliver of the door vanishes at once.
  const rest = interpolate(u, [0.6, 0.95], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const shape = r
    ? `M${left},${top + h} V${top + r} A${r},${r} 0 0 1 ${left + w},${top + r} V${top + h} Z`
    : `M${left},${top} H${left + w} V${top + h} H${left} Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<filter id="f" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${W + 200}" height="${H + 200}"><feGaussianBlur stdDeviation="${feather.toFixed(1)}"/></filter>` +
    `<rect width="${W}" height="${H}" fill="white" fill-opacity="${rest.toFixed(3)}"/>` +
    `<path d="${shape}" fill="white" filter="url(#f)"/></svg>`;
  const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  const opacity = interpolate(u, [0, 0.45], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill style={{ opacity, WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }}>
      {moved}
    </AbsoluteFill>
  );
};

const ClipLayer: React.FC<{ reel: ReelProps; index: number; frames: number; tail: number; from: number }> = ({
  reel,
  index,
  frames,
  tail,
  from,
}) => {
  const clip = reel.clips[index];
  const next = reel.clips[index + 1];
  const fx = (c: ReelProps["clips"][number] | undefined, i: number): Fx =>
    c ? { type: transitionOf(c), n: transitionFrames(c), dir: c.transitionDir ? DIRS[c.transitionDir] : whipDir(i), directed: !!c.transitionDir, portal: c.portal, at: c.at } : null;
  const t = useTransitionFx(index > 0 ? fx(clip, index) : null, fx(next, index + 1), frames);
  const cam = useCameraFx(reel, clip, from);
  const fxId = `fx-${React.useId().replace(/:/g, "")}`;
  const rgb = t.rgb && t.rgb > 0.3 ? t.rgb : 0;
  const streak = t.streak && t.streak.x + t.streak.y > 0.5 ? t.streak : undefined;
  const media = <Media reel={reel} clip={clip} motion={motionFor(reel, clip, index)} frames={frames + tail} />;
  const layer = (
    <AbsoluteFill style={t.opacity !== undefined ? { opacity: t.opacity } : undefined}>
      {(rgb > 0 || streak) && <FxFilter id={fxId} px={rgb} streak={streak} />}
      <AbsoluteFill style={rgb > 0 || streak ? { ...t.style, filter: [t.style.filter, `url(#${fxId})`].filter(Boolean).join(" ") } : t.style}>
        {cam.transform ? <AbsoluteFill style={cam}>{media}</AbsoluteFill> : media}
      </AbsoluteFill>
      {clip.mist && <Mist amount={clip.mist.amount} y={clip.mist.y} at={from} />}
      {t.overlay && <AbsoluteFill style={{ backgroundColor: t.overlay.color, opacity: t.overlay.opacity }} />}
      {t.glow && <AbsoluteFill style={{ ...t.glow, mixBlendMode: "screen" }} />}
    </AbsoluteFill>
  );
  // Incoming match and outgoing light-order dissolve can both apply to one shot.
  if (index > 0 && transitionOf(clip) === "match" && clip.match) {
    const matched = <MatchIn match={clip.match} n={transitionFrames(clip)}>{layer}</MatchIn>;
    return next && transitionOf(next) === "luma" ? <LumaOut frames={frames} n={transitionFrames(next)}>{matched}</LumaOut> : matched;
  }
  if (next && transitionOf(next) === "luma") {
    return <LumaOut frames={frames} n={transitionFrames(next)}>{layer}</LumaOut>;
  }
  if (index > 0 && transitionOf(clip) === "ripple" && clip.at) {
    return <RippleIn at={clip.at} n={transitionFrames(clip)}>{layer}</RippleIn>;
  }
  if (index > 0 && transitionOf(clip) === "portal" && clip.portal) {
    return <PortalIn portal={clip.portal} n={transitionFrames(clip)}>{layer}</PortalIn>;
  }
  if (index > 0 && transitionOf(clip) === "subject-wipe" && isVideo(reel.clips[index - 1].src)) {
    const starts = clipStarts(reel);
    return <SubjectWipe reel={reel} index={index} offset={from - starts[index - 1].from} n={transitionFrames(clip)}>{layer}</SubjectWipe>;
  }
  return layer;
};

// Words rise and sharpen in one after another, then leave together.
const RevealText: React.FC<{
  text: string;
  style: React.CSSProperties;
  delay?: number;
  outAt: number;
  balance?: boolean;
  // Energetic reels: each word slides up out of a hidden edge, one every `kinetic` frames
  // (on the beat), and they all slide up and away at the end. No blur, no fade.
  kinetic?: number;
}> = ({ text, style, delay = 0, outAt, balance = true, kinetic }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [outAt - fr(6), outAt], [0, 1], clamp);
  const words = text.split(" ");
  // Two even lines for longer text, so no single word is left on its own.
  let lines = [words];
  if (balance && text.length > 16 && words.length > 2) {
    let best = 1;
    for (let k = 1; k < words.length; k++) {
      const len = (a: string[]) => a.join(" ").length;
      const cur = Math.max(len(words.slice(0, k)), len(words.slice(k)));
      const prev = Math.max(len(words.slice(0, best)), len(words.slice(best)));
      if (cur < prev) best = k;
    }
    lines = [words.slice(0, best), words.slice(best)];
  }
  let n = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", ...style }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", columnGap: "0.24em", whiteSpace: "nowrap" }}>
          {line.map((w) => {
            if (kinetic) {
              const i = n++;
              const ease = Easing.bezier(0.16, 1, 0.3, 1);
              const inK = interpolate(frame, [delay + i * kinetic, delay + i * kinetic + fr(9)], [0, 1], { ...clamp, easing: ease });
              const outK = interpolate(frame, [outAt - fr(7), outAt], [0, 1], { ...clamp, easing: Easing.bezier(0.7, 0, 0.84, 0) });
              return (
                <span key={i} style={{ display: "inline-block", overflow: "hidden", padding: "0.06em 0.02em 0.14em", margin: "-0.06em -0.02em -0.14em" }}>
                  <span style={{ display: "inline-block", transform: `translateY(${(1 - inK) * 115 - outK * 115}%)` }}>{w}</span>
                </span>
              );
            }
            const s = spring({ frame: frame - delay - n++ * fr(2), fps, config: SNAP });
            return (
              <span
                key={n}
                style={{
                  display: "inline-block",
                  opacity: Math.min(1, s) * (1 - out),
                  transform: `translateY(${(1 - s) * 28 - out * 16}px)`,
                  filter: `blur(${(1 - Math.min(1, s)) * 10 + out * 8}px)`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// Mist: two layers of soft, horizontally stretched noise (one fixed texture each, so it
// doesn't boil), white with the noise as alpha, drifting sideways at different speeds in
// a feathered band around y. `at` is the clip's start in the reel, so the drift carries on
// across cuts instead of restarting.
const Mist: React.FC<{ amount: number; y: number; at: number }> = ({ amount, y, at }) => {
  const f = useCurrentFrame() + at;
  const id = `mist-${React.useId().replace(/:/g, "")}`;
  const band = `linear-gradient(180deg, transparent ${(y - 0.32) * 100}%, #000 ${(y - 0.1) * 100}%, #000 ${(y + 0.12) * 100}%, transparent ${(y + 0.34) * 100}%)`;
  const layer = (k: number, freq: string, seed: number, speed: number, opacity: number) => (
    <AbsoluteFill style={{ width: 2160, transform: `translateX(${-((f * speed) % 1080)}px)`, opacity }}>
      <svg width={2160} height={1920}>
        <filter id={`${id}-${k}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={3} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3.4 -1.15" />
          <feGaussianBlur stdDeviation={18} />
        </filter>
        <rect width={2160} height={1920} filter={`url(#${id}-${k})`} />
      </svg>
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ opacity: amount, WebkitMaskImage: band, maskImage: band, pointerEvents: "none", overflow: "hidden" }}>
      {layer(0, "0.0009 0.0042", 7, 0.45, 1)}
      {layer(1, "0.0016 0.007", 23, 0.9, 0.7)}
    </AbsoluteFill>
  );
};

// Ink title: the words in brush calligraphy, written on left to right behind a soft,
// ragged brush edge while the ink settles (a slight bleed that tightens), then a small
// vermilion seal with the place stamps beside them, like the chop on a scroll painting.
// Everything fades out together.
const InkTitle: React.FC<{ text: string; place: string; outAt: number }> = ({ text, place, outAt }) => {
  const f = useCurrentFrame();
  const write = fr(30);
  const t0 = fr(4);
  const k = interpolate(f, [t0, t0 + write], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const edge = k * 118 - 9;
  const mask = `linear-gradient(100deg, #000 ${edge}%, rgba(0,0,0,0.55) ${edge + 4}%, transparent ${edge + 9}%)`;
  const bleed = interpolate(f, [t0, t0 + write + fr(10)], [5, 0], clamp);
  const sealAt = t0 + write + fr(4);
  const stamp = interpolate(f, [sealAt, sealAt + fr(7)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(f, [outAt - fr(12), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const words = place.split("·").pop()!.trim().toUpperCase().split(" ");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, opacity: 1 - out, filter: `drop-shadow(0 4px 18px rgba(0,0,0,0.45)) blur(${out * 4}px)` }}>
      <div style={{ fontFamily: brushSerif, fontSize: 112, letterSpacing: 3, lineHeight: 1.0, padding: "0.12em 0.1em 0.22em", color: "#FBF6EC", whiteSpace: "nowrap", WebkitMaskImage: mask, maskImage: mask,
        filter: `blur(${bleed * 0.35}px)`, textShadow: `0 0 ${bleed * 2}px rgba(251,246,236,0.6)` }}>
        {text}
      </div>
      <div style={{ width: 92, height: 92, flex: "none", borderRadius: 8, background: "#B8322A", boxShadow: "inset 0 0 0 4px #B8322A, inset 0 0 0 6px rgba(255,236,224,0.85)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: stamp, transform: `rotate(-4deg) scale(${1.35 - 0.35 * stamp})` }}>
        {words.map((w, i) => (
          <div key={i} style={{ fontFamily: brushSerif, fontSize: w.length > 6 ? 17 : 21, letterSpacing: 2, lineHeight: 1.25, color: "#FFF1E6" }}>{w}</div>
        ))}
      </div>
    </div>
  );
};

const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const frame = useCurrentFrame();
  if (amount <= 0) return null;
  return (
    <AbsoluteFill style={{ opacity: amount, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={Math.floor(frame / fr(1)) % 12} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

// Breath title: Cormorant Garamond Light Italic; each letter comes into focus out of a
// soft blur, slowly, one after another (an inhale), and the line leaves the same way
// (exhale). The place tag in thin, widely spaced Jost fades in last.
const BreathTitle: React.FC<{ text: string; place: string; outAt: number }> = ({ text, place, outAt }) => {
  const f = useCurrentFrame();
  const ease = Easing.bezier(0.33, 0, 0.2, 1);
  const out = interpolate(f, [outAt - fr(14), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const chars = text.split("");
  const tag = interpolate(f, [fr(22), fr(40)], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: 1 - out, filter: `blur(${out * 10}px)` }}>
      <div style={{ fontFamily: cormorant, fontStyle: "italic", fontWeight: 300, fontSize: 86, lineHeight: 1.05, letterSpacing: "0.01em", whiteSpace: "nowrap", textShadow: "0 2px 34px rgba(0,0,0,0.35)" }}>
        {chars.map((ch, i) => {
          const k = interpolate(f, [i * 1.6, i * 1.6 + fr(20)], [0, 1], { ...clamp, easing: ease });
          return (
            <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: k, filter: `blur(${(1 - k) * 12}px)`, transform: `translateY(${(1 - k) * 6}px)` }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div style={{ fontFamily: jost, fontWeight: 300, fontSize: 24, letterSpacing: "0.55em", marginRight: "-0.55em", textTransform: "uppercase", marginTop: 30, opacity: 0.9 * tag, filter: `blur(${(1 - tag) * 6}px)`, textShadow: "0 1px 18px rgba(0,0,0,0.4)" }}>
        {place}
      </div>
    </div>
  );
};

// Real motion blur (Remotion's HtmlInCanvasMotionBlur: each frame averages snapshots taken
// at fractional frames, a 180-degree shutter like a film camera), for titles that move.
// `shadow` is applied to the blurred result, so it streaks with the letters.
const MotionBlur: React.FC<{ on: boolean; shadow?: string; children: React.ReactNode }> = ({ on, shadow, children }) => {
  const { width, height } = useVideoConfig();
  if (!on) return <>{children}</>;
  return (
    <AbsoluteFill style={{ filter: shadow }}>
      <HtmlInCanvasMotionBlur width={width} height={height} samples={12} shutterAngle={180}>{children}</HtmlInCanvasMotionBlur>
    </AbsoluteFill>
  );
};

// Race title: Anton capitals slanted forward (a livery lettering), two balanced lines.
// Each word drives into its own slot from the left on its half-beat, braking into place
// (the slant eases from steep to set), and at the end the words drive off to the right.
const RaceTitle: React.FC<{ text: string; outAt: number; step: number }> = ({ text, outAt, step }) => {
  const f = useCurrentFrame();
  const words = text.toUpperCase().split(" ");
  let best = 1;
  const len = (a: string[]) => a.join(" ").length;
  for (let k = 1; k < words.length; k++)
    if (Math.max(len(words.slice(0, k)), len(words.slice(k))) < Math.max(len(words.slice(0, best)), len(words.slice(best)))) best = k;
  const lines = words.length > 2 ? [words.slice(0, best), words.slice(best)] : [words];
  const brake = Easing.bezier(0.12, 0.9, 0.25, 1);
  const off = interpolate(f, [outAt - fr(8), outAt], [0, 1], { ...clamp, easing: Easing.bezier(0.6, 0, 0.9, 0.4) });
  let n = 0;
  return (
    // No shadow here: it is added to the finished (motion-blurred) title by MotionBlur. A
    // text-shadow in each masked word slot was cut at the slot edge (grey boxes), and a
    // shadow captured by the motion blur left boxes too.
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: anton, fontSize: 112, lineHeight: 0.98,
      color: "#F4F0E8" }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", columnGap: "0.22em", whiteSpace: "nowrap" }}>
          {line.map((w) => {
            const i = n++;
            const k = interpolate(f, [i * step, i * step + fr(8)], [0, 1], { ...clamp, easing: brake });
            return (
              // Each word drives into its own slot (masked to it), so it never runs over the
              // word before; the slot is a little wider than the slanted letters.
              <span key={i} style={{ display: "inline-block", overflow: "hidden", padding: "0.04em 0.12em", margin: "-0.04em -0.12em" }}>
                <span style={{ display: "inline-block", opacity: (k > 0 ? 1 : 0) * (1 - off),
                  transform: `translateX(${(1 - k) * -140 + off * 140}%) skewX(${-9 - (1 - k) * 16 - off * 12}deg)` }}>
                  {w}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// Hand title: the hook handwritten in Caveat, as if written on a note in the village's
// own lettering. Each line is written on left to right at writing speed (a soft-edged
// reveal running ahead like the pen), lines tilted a little and the second set in; no
// place tag. At the end the ink fades.
const HandTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const words = text.split(" ");
  let best = 1;
  const len = (a: string[]) => a.join(" ").length;
  for (let k = 1; k < words.length; k++)
    if (Math.max(len(words.slice(0, k)), len(words.slice(k))) < Math.max(len(words.slice(0, best)), len(words.slice(best)))) best = k;
  const lines = words.length > 2 ? [words.slice(0, best).join(" "), words.slice(best).join(" ")] : [text];
  const perChar = fr(1.6); // ~19 characters a second, a quick hand (leaves time to read)
  const out = interpolate(f, [outAt - fr(9), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  let start = fr(2);
  return (
    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "flex-start", marginLeft: SAFE.left - SAFE.right + 30,
      transform: "rotate(-3deg)", opacity: 1 - out, filter: `drop-shadow(0 3px 12px rgba(0,0,0,0.5)) blur(${out * 3}px)` }}>
      {lines.map((line, i) => {
        const t0 = start;
        const dur = line.length * perChar;
        start += dur + fr(4);
        const k = interpolate(f, [t0, t0 + dur], [0, 1], clamp);
        const edge = k * 112 - 6; // % of the line revealed, soft 6% pen edge
        const mask = `linear-gradient(90deg, #000 ${edge}%, transparent ${edge + 6}%)`;
        return (
          <div key={i} style={{ fontFamily: caveat, fontWeight: 600, fontSize: 108, lineHeight: 1.0, color: "#FFFDF8", whiteSpace: "nowrap",
            marginLeft: i * 90, WebkitMaskImage: mask, maskImage: mask }}>
            {line}
          </div>
        );
      })}
    </div>
  );
};

// Exhale title: lowercase light Jost, two lines split at the comma, the second set in
// from the left (staggered, airy), no place tag. Each line comes out of a haze; the
// letter spacing widens slowly for as long as the title is on screen, so the words seem
// to breathe out; at the end they thin into mist.
const ExhaleTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const cut = text.indexOf(",");
  const lines = (cut > 0 ? [text.slice(0, cut + 1), text.slice(cut + 1).trim()] : [text]).map((l) => l.toLowerCase());
  const ease = Easing.bezier(0.25, 0.1, 0.25, 1);
  const out = interpolate(f, [outAt - fr(16), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  return (
    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "flex-start", marginLeft: SAFE.left - SAFE.right + 20 }}>
      {lines.map((line, i) => {
        const start = i * fr(16);
        const k = interpolate(f, [start, start + fr(30)], [0, 1], { ...clamp, easing: ease });
        const track = interpolate(f, [start, outAt], [0.02, 0.16], { ...clamp, easing: Easing.out(Easing.quad) }) + out * 0.06;
        return (
          <div
            key={i}
            style={{
              fontFamily: jost, fontWeight: 300, fontSize: 84, lineHeight: 1.12, whiteSpace: "nowrap",
              letterSpacing: `${track}em`, marginLeft: i * 120,
              opacity: k * (1 - out), filter: `blur(${(1 - k) * 10 + out * 12}px)`,
              transform: `translateY(${(1 - k) * 10 - out * 8}px)`,
              textShadow: "0 2px 30px rgba(0,0,0,0.38)",
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

// Shutter title (a push through a window whose shutters stand open): upright Cormorant
// Garamond; each line opens from its centre outward with soft edges, the way the shutters
// part, while its letters ease apart; it leaves by growing and softening as the camera
// carries on through the window, as if passing through the words.
const ShutterTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const ease = Easing.bezier(0.33, 0, 0.2, 1);
  const out = interpolate(f, [outAt - fr(12), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const lines = [text];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      transform: `scale(${1 + 0.16 * out})`, opacity: 1 - out, filter: `blur(${out * 8}px)` }}>
      {lines.map((line, i) => {
        const start = fr(6) + i * fr(8);
        const k = interpolate(f, [start, start + fr(26)], [0, 1], { ...clamp, easing: ease });
        const half = k * 56; // % of the line's width open on each side of the centre
        const soft = 7;
        const mask = `linear-gradient(90deg, transparent ${50 - half - soft}%, #000 ${50 - half}%, #000 ${50 + half}%, transparent ${50 + half + soft}%)`;
        const track = interpolate(k, [0, 1], [-0.02, 0.035]);
        return (
          <div key={i} style={{ fontFamily: cormorant, fontWeight: 500, fontSize: 124, lineHeight: 1.05, whiteSpace: "nowrap", color: "#FFF8EC",
            letterSpacing: `${track}em`, marginRight: `-${track}em`, WebkitMaskImage: mask, maskImage: mask,
            textShadow: "0 2px 6px rgba(0,0,0,0.35), 0 4px 34px rgba(0,0,0,0.45)" }}>
            {line}
          </div>
        );
      })}
    </div>
  );
};

// Lift title (a paramotor wing inflating and lifting off): bold Inter capitals; the
// letters rise into place one after another from left to right, the way the wing comes
// up over the pilot from one side, overshooting a touch as it does; at the end they keep
// rising out of the frame in the same order, like the lift-off.
const LiftTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const cut = text.indexOf(",");
  const lines = cut > 0 ? [text.slice(0, cut + 1), text.slice(cut + 1).trim()] : [text];
  const rise = Easing.bezier(0.2, 1.25, 0.4, 1); // a small overshoot, like the canopy loading up
  const total = lines.join("").length;
  const step = 1.3; // frames between letters
  const leave = outAt - fr(14);
  let n = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {lines.map((line, li) => (
        <div key={li} style={{ fontFamily: sans, fontWeight: 600, fontSize: li === 0 ? 92 : 64, lineHeight: 1.08, letterSpacing: "0.05em",
          marginRight: "-0.05em", textTransform: "uppercase", whiteSpace: "nowrap", textShadow: "0 2px 4px rgba(0,0,0,0.35), 0 6px 30px rgba(0,0,0,0.45)" }}>
          {line.split("").map((ch, ci) => {
            const k = n++;
            const t0 = fr(4) + k * step;
            const up = interpolate(f, [t0, t0 + fr(14)], [0, 1], { ...clamp, easing: rise });
            const o = interpolate(f, [leave + k * (fr(8) / total), leave + k * (fr(8) / total) + fr(8)], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
            return (
              <span key={ci} style={{ display: "inline-block", whiteSpace: "pre", opacity: Math.min(1, up * 1.6) * (1 - o),
                transform: `translateY(${(1 - up) * 70 - o * 120}px) rotate(${(1 - up) * -8}deg)` }}>{ch}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// Air title (flying, a soaring song): thin Jost capitals, widely spaced, in the sky.
// Letters come out of a soft blur from the centre outward, like shapes out of cloud,
// while the whole line drifts slowly up and its spacing opens; at the end it rises a
// little faster and dissolves back into blur.
const AirTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const chars = text.toUpperCase().split("");
  const mid = (chars.length - 1) / 2;
  const ease = Easing.bezier(0.25, 0.1, 0.25, 1);
  const out = interpolate(f, [outAt - fr(16), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const drift = interpolate(f, [0, outAt], [14, -10], clamp) - out * 26;
  const track = interpolate(f, [0, outAt], [0.26, 0.36], { ...clamp, easing: Easing.out(Easing.quad) });
  return (
    <div style={{ fontFamily: jost, fontWeight: 300, fontSize: 54, lineHeight: 1, whiteSpace: "nowrap", letterSpacing: `${track}em`,
      marginRight: `-${track}em`, transform: `translateY(${drift}px)`, textShadow: "0 2px 18px rgba(0,0,0,0.38), 0 0 2px rgba(0,0,0,0.25)" }}>
      {chars.map((ch, i) => {
        const t0 = fr(4) + Math.abs(i - mid) * 1.6;
        const k = interpolate(f, [t0, t0 + fr(22)], [0, 1], { ...clamp, easing: ease });
        return (
          <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: k * (1 - out), filter: `blur(${(1 - k) * 9 + out * 10}px)` }}>{ch}</span>
        );
      })}
    </div>
  );
};

// Lockup title (a film-title lockup, first used on the paramotoring reel): the first word
// in small, widely spaced Inter capitals over the rest in a large Instrument Serif italic.
// The small word fades in as its spacing settles; the big line follows a beat later, each
// letter rising softly out of blur; at the end the whole lockup lifts and fades as one.
const LockupTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const cut = text.indexOf(" ");
  const top = cut > 0 ? text.slice(0, cut) : "";
  const main = cut > 0 ? text.slice(cut + 1) : text;
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  const out = interpolate(f, [outAt - fr(14), outAt], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const kTop = interpolate(f, [fr(3), fr(24)], [0, 1], { ...clamp, easing: ease });
  const track = interpolate(kTop, [0, 1], [0.9, 0.5]);
  const shadow = "0 2px 6px rgba(0,0,0,0.35), 0 4px 30px rgba(0,0,0,0.45)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: 1 - out,
      transform: `translateY(${-out * 24}px)`, filter: out > 0 ? `blur(${out * 6}px)` : undefined, textShadow: shadow }}>
      {top && (
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 36, letterSpacing: `${track}em`, marginRight: `-${track}em`,
          textTransform: "uppercase", opacity: kTop, marginBottom: 6 }}>{top}</div>
      )}
      <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 148, lineHeight: 1, whiteSpace: "nowrap" }}>
        {main.split("").map((ch, i) => {
          const t0 = fr(12) + i * 1.8;
          const k = interpolate(f, [t0, t0 + fr(20)], [0, 1], { ...clamp, easing: ease });
          return (
            <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: k,
              transform: `translateY(${(1 - k) * 22}px)`, filter: `blur(${(1 - k) * 8}px)` }}>{ch}</span>
          );
        })}
      </div>
    </div>
  );
};

// Palace closing line: Bodoni italic, letters fade in one after another while the spacing
// settles from wide to set (the title's move), and it stays to the last frame.
const PalaceLine: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const f = useCurrentFrame() - delay;
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  const track = interpolate(f, [0, fr(34)], [0.28, 0.04], { ...clamp, easing: ease });
  return (
    <div style={{ fontFamily: bodoni, fontStyle: "italic", fontWeight: 400, fontSize: 70, lineHeight: 1.05, whiteSpace: "nowrap",
      letterSpacing: `${track}em`, marginRight: `-${track}em`, textShadow: "0 2px 30px rgba(0,0,0,0.4)" }}>
      {text.split("").map((ch, i) => (
        <span key={i} style={{ whiteSpace: "pre", opacity: interpolate(f, [i * 1.5, i * 1.5 + fr(12)], [0, 1], clamp) }}>{ch}</span>
      ))}
    </div>
  );
};

// Palace title: the part before the first comma in spaced Bodoni capitals; each letter
// fades in while the spacing tightens from wide to settled (a luxury-house title), then
// the rest in Bodoni italic. Leaves as one, rising slightly and softening.
const PalaceTitle: React.FC<{ text: string; outAt: number }> = ({ text, outAt }) => {
  const f = useCurrentFrame();
  const cut = text.indexOf(",");
  const main = (cut > 0 ? text.slice(0, cut) : text).toUpperCase();
  const sub = cut > 0 ? text.slice(cut + 1).trim() : "";
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  const out = interpolate(f, [outAt - fr(8), outAt], [0, 1], clamp);
  const track = interpolate(f, [0, fr(30)], [0.62, 0.3], { ...clamp, easing: ease });
  const subIn = interpolate(f, [fr(16), fr(30)], [0, 1], { ...clamp, easing: ease });
  const shadow = "0 2px 30px rgba(0,0,0,0.35)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: 1 - out, transform: `translateY(${-out * 14}px)`, filter: `blur(${out * 6}px)` }}>
      <div style={{ fontFamily: bodoni, fontWeight: 500, fontSize: 96, letterSpacing: `${track}em`, marginRight: `-${track}em`, lineHeight: 1, whiteSpace: "nowrap", textShadow: shadow }}>
        {main.split("").map((ch, i) => (
          <span key={i} style={{ opacity: interpolate(f, [i * 2, i * 2 + fr(12)], [0, 1], clamp) }}>{ch}</span>
        ))}
      </div>
      {sub && (
        <div style={{ fontFamily: bodoni, fontStyle: "italic", fontWeight: 400, fontSize: 54, marginTop: 18, opacity: subIn, transform: `translateY(${(1 - subIn) * 10}px)`, textShadow: shadow }}>
          {sub}
        </div>
      )}
    </div>
  );
};

export const Reel: React.FC<ReelProps> = (reel) => {
  const frame = useCurrentFrame();
  const total = totalFrames(reel);
  const starts = clipStarts(reel);
  const hookEnd = hookEndFrame(reel);
  const last = starts[starts.length - 1];
  // No title: nothing to fade (and with a fine beat grid the hook span can be shorter
  // than the fades themselves).
  const hookOn = reel.hook.trim() === "" ? 0 : interpolate(frame, [0, fr(4), hookEnd - fr(6), hookEnd], [0, 1, 1, 0], clamp);
  const closingOn = reel.closing ? interpolate(frame, [last.from, last.from + fr(6)], [0, 1], clamp) : 0;
  // Where the hook / closing text and their darkening bands sit (fractions of frame height).
  const hookBand = textY(reel, "hook");
  const band = textY(reel, "closing");
  const showText = !reel.hideText;
  const scrim = (c: number) =>
    `linear-gradient(180deg, rgba(0,0,0,0) ${(c - 0.28) * 100}%, rgba(0,0,0,0.42) ${(c - 0.1) * 100}%, rgba(0,0,0,0.42) ${(c + 0.1) * 100}%, rgba(0,0,0,0) ${(c + 0.28) * 100}%)`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {reel.clips.map((_, i) => (
        <Sequence
          key={i}
          from={starts[i].from}
          durationInFrames={starts[i].frames + tailFrames(reel, i)}
          name={`${i + 1} ${reel.clips[i].src}`}
        >
          <ClipLayer reel={reel} index={i} frames={starts[i].frames} tail={tailFrames(reel, i)} from={starts[i].from} />
        </Sequence>
      ))}

      {/* Vignette, plus a soft darkening behind text while it is on screen. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 85% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${reel.grade.vignette}) 100%)`,
        }}
      />
      {/* hook: "" = no opening title at all (no text, no darkened band). */}
      {showText && reel.hook.trim() !== "" && <AbsoluteFill style={{ opacity: hookOn, background: scrim(hookBand) }} />}
      {showText && <AbsoluteFill style={{ opacity: closingOn, background: scrim(band) }} />}
      <Grain amount={reel.grade.grain} />

      {showText && reel.hook.trim() !== "" && <Sequence durationInFrames={hookEnd} name="Hook">
        <MotionBlur on={reel.titleStyle === "race"} shadow="drop-shadow(0 4px 14px rgba(0,0,0,0.45))">
        <AbsoluteFill style={{ color: "#FBF8F2" }}>
          <div
            style={{
              position: "absolute",
              top: `${hookBand * 100}%`,
              left: SAFE.right,
              right: SAFE.right,
              transform: "translateY(-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            {reel.titleStyle === "hand" ? (
              <HandTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "race" ? (
              <RaceTitle text={reel.hook} outAt={hookEnd} step={beatFrame(reel, 0.5)} />
            ) : reel.titleStyle === "exhale" ? (
              <ExhaleTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "breath" ? (
              <BreathTitle text={reel.hook} place={reel.place} outAt={hookEnd} />
            ) : reel.titleStyle === "palace" ? (
              <PalaceTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "shutter" ? (
              <ShutterTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "lift" ? (
              <LiftTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "air" ? (
              <AirTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "lockup" ? (
              <LockupTitle text={reel.hook} outAt={hookEnd} />
            ) : reel.titleStyle === "ink" ? (
              <InkTitle text={reel.hook} place={reel.place} outAt={hookEnd} />
            ) : (
            <RevealText
              text={reel.hook}
              outAt={hookEnd}
              kinetic={reel.style === "energetic" ? beatFrame(reel, 0.5) : undefined}
              style={{
                fontFamily: serif,
                fontSize: 88,
                lineHeight: 1.02,
                letterSpacing: -1,
                textShadow: "0 4px 40px rgba(0,0,0,0.35)",
              }}
            />
            )}
            {reel.placeTag && reel.titleStyle !== "breath" && reel.titleStyle !== "exhale" && reel.titleStyle !== "hand" && reel.titleStyle !== "shutter" && reel.titleStyle !== "lift" && reel.titleStyle !== "air" && reel.titleStyle !== "lockup" && reel.titleStyle !== "ink" && <RevealText
              text={reel.place.toUpperCase()}
              delay={reel.titleStyle === "palace" ? fr(26) : reel.style === "energetic" ? beatFrame(reel, 0.5) * reel.hook.split(" ").length : fr(7)}
              outAt={hookEnd}
              kinetic={reel.style === "energetic" ? fr(1) : undefined}
              balance={false}
              style={{ fontFamily: sans, fontWeight: 600, fontSize: 22, letterSpacing: 6, marginTop: 28, opacity: 0.92 }}
            />}
          </div>
        </AbsoluteFill>
        </MotionBlur>
      </Sequence>}

      {showText && reel.closing && (
        <Sequence from={last.from} durationInFrames={last.frames} name="Closing">
          <AbsoluteFill style={{ alignItems: "center", padding: `0 ${SAFE.right}px`, color: "#FBF8F2" }}>
            <div style={{ position: "absolute", top: `${band * 100}%`, left: 0, right: 0, transform: "translateY(-50%)", display: "flex", justifyContent: "center" }}>
            {reel.titleStyle === "palace" ? (
              <PalaceLine text={reel.closing} delay={fr(3)} />
            ) : (
            <RevealText
              text={reel.closing}
              delay={fr(3)}
              outAt={last.frames + fr(10)}
              style={{ fontFamily: serif, fontStyle: "italic", fontSize: 72, lineHeight: 1.05, textAlign: "center" }}
            />
            )}
            </div>
          </AbsoluteFill>
        </Sequence>
      )}

      {reel.track.file && (
        <Html5Audio
          src={staticFile(`${reel.slug}/${reel.track.file}`)}
          trimBefore={Math.round(musicStart(reel) * FPS)}
          volume={(f) =>
            reel.music.volume * interpolate(f, [0, fr(3), total - fr(6), total - 1], [0, 1, 1, 0], clamp)
          }
        />
      )}
    </AbsoluteFill>
  );
};
