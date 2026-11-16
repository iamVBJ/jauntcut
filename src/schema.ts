import { z } from "zod";

// push-into: a push toward the clip's focal point that is already moving on the first
// frame and keeps speeding up (no ease-out), so it builds into a portal transition as one
// continuous move instead of a steady zoom followed by a sudden fast push.
export const motionSchema = z.enum(["push-in", "push-into", "pull-out", "pan-left", "pan-right", "pan-up", "pan-down", "still"]);

// Colour adjustments. All default to "no change", so existing reels render identically.
export const gradeAdjustSchema = z.object({
  exposure: z.number().min(-2).max(2).optional(), // stops; +0.3 = a touch brighter
  temperature: z.number().min(-1).max(1).optional(), // + warmer (amber), - cooler (blue)
  tint: z.number().min(-1).max(1).optional(), // + magenta, - green
  contrast: z.number().min(0.6).max(1.5).optional(),
  saturation: z.number().min(0).max(2).optional(),
  warmth: z.number().min(0).max(0.3).optional(), // legacy sepia warmth
});

// subject-wipe: the next shot opens up behind the previous shot's moving subject (a kart
// crossing frame), using its per-frame cutout; the subject stays on top as it leaves.
// portal: the next shot appears inside an arch-topped opening of the previous shot (a
// doorway, `portal` on the incoming clip) and the camera pushes through it.
// bloom: a light in the previous shot (`at`: x/y) swells to fill the frame and this shot
// emerges from the glow. ripple: this shot spreads out from a point of the previous shot
// (`at`: e.g. water) behind an expanding, rippling wavefront.
// match: graphic-match dissolve; the incoming shot starts scaled/placed so a shape in it
// (`match.to`) sits exactly on a shape of the previous shot (`match.from`), crossfades,
// then glides to its own framing. luma: the previous shot dissolves in order of
// brightness (brightest first, shadows last), uncovering the next one.
export const transitionSchema = z.enum(["cut", "whip", "dissolve", "dip-black", "dip-white", "zoom", "blur", "glitch", "subject-wipe", "portal", "bloom", "ripple", "match", "luma", "sketch", "glaze"]);

export const clipSchema = z.object({
  // File name as dropped in topics/<slug>/raw, e.g. "IMG_2549.mov".
  src: z.string(),
  // Length in beats of the music. Cuts land exactly on beats.
  beats: z.number().int().min(1).default(2),
  // Video: seconds into the clip to start from.
  startAt: z.number().min(0).default(0),
  // Video: playback speed, and an optional ramp to a new speed partway through.
  speed: z.number().positive().default(1),
  ramp: z.object({ atBeat: z.number().positive(), speed: z.number().positive() }).optional(),
  // Where the subject is, 0-1 from left/top. Cover-fit crops around it.
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.5 }),
  // Footage wider than 9:16: the crop's centre moves from x0 to x1 over the clip at
  // constant speed (fractions of the frame, like focal.x).
  reframe: z.object({ x0: z.number().min(0).max(1), x1: z.number().min(0).max(1) }).optional(),
  // Extra crop around the focal point. 1 = none.
  zoom: z.number().min(1).max(3).default(1),
  // Leave empty to vary motion automatically.
  motion: motionSchema.optional(),
  // Whip-pan into this clip instead of a hard cut (same as transition: "whip").
  whip: z.boolean().default(false),
  // How this clip comes in: cut (default), whip, dissolve, dip-black, dip-white
  // (flash), zoom (punch through), blur. Seconds overrides the default length.
  transition: transitionSchema.optional(),
  transitionSeconds: z.number().min(0.05).max(2).optional(),
  // Whip direction = the way the picture moves; match it to the camera's pan
  // (camera pans left -> picture moves right). Default alternates.
  transitionDir: z.enum(["left", "right", "up", "down"]).optional(),
  // Beat-synced camera effects (energetic edits):
  //   pulse: zoom punch on every beat of the clip (amount, e.g. 0.05)
  //   shake: camera shake that hits at the clip start and settles (amount, e.g. 1)
  //   shakeAtBeat: when the shake hits, in beats from the clip start (default 0)
  pulse: z.number().min(0).max(0.2).default(0),
  shake: z.number().min(0).max(3).default(0),
  shakeAtBeat: z.number().min(0).default(0),
  // Video: freeze the picture from this beat to the end of the clip, with a slow
  // push-in (the still is extracted by `npm run derive`).
  freeze: z.object({ atBeat: z.number().positive() }).optional(),
  // Speed ramps for whips: start at rampIn x the clip speed and ease down to it, and/or
  // ease up to rampOut x at the cut, over rampBeats. Video only.
  rampIn: z.number().min(1).max(6).default(1),
  rampOut: z.number().min(1).max(6).default(1),
  rampBeats: z.number().positive().default(0.75),
  // Video: text placed IN the scene. It is motion-tracked to the ground it stands on
  // (moves with the camera), its letters rise out of the ground line, and the moving
  // subject (a kart) passes in front of it (per-frame Vision cutouts). x = centre, y =
  // ground line (bottom of the letters), both fractions of the frame at clip beat
  // `atBeat`; size in px.
  scene: z
    .object({
      text: z.string(),
      x: z.number().min(-0.5).max(1.5).default(0.5),
      y: z.number().min(0).max(1),
      size: z.number().min(40).max(600).default(200),
      atBeat: z.number().min(0).default(0),
      riseAtBeat: z.number().min(0).default(0),
      // How much of the camera's sideways move the text follows: 1 = fixed to the scene,
      // 0 = stays where x puts it on screen (still rises from the ground, subject still
      // passes in front).
      followX: z.number().min(0).max(1).default(1),
      // Letters sink back into the ground from this beat (before the camera carries them off).
      sinkAtBeat: z.number().min(0).optional(),
      // The subject erases the letters as it drives through them: behind it they smear
      // away in its wake.
      erase: z.boolean().default(false),
    })
    .optional(),
  // Video filmed at 30 fps: play a motion-interpolated 60 fps version (`npm run derive`),
  // so fast pans and speed ramps step evenly instead of juddering. Very fast pans can
  // tear (motion estimation fails): check the frames.
  interpolate: z.boolean().default(false),
  // Photo: a title standing in the scene BEHIND the subject (Vision cutout of the photo,
  // rendered by `npm run derive`): letters rise out of the ground line y (bottom of the
  // letters, fraction of the frame before `zoom`), x = centre; size in px before zoom.
  behind: z
    .object({
      text: z.string(),
      x: z.number().min(0).max(1).default(0.5),
      y: z.number().min(0.05).max(0.95),
      size: z.number().min(30).max(600).default(200),
      riseAtBeat: z.number().min(0).default(0),
      // Letter colour (CSS), shown exactly: the photo is graded, the title is not.
      color: z.string().default("#F4F0E8"),
      // Edge around coloured letters (CSS text-shadow); default a soft dark edge.
      shadow: z.string().optional(),
    })
    .optional(),
  // Play the moment backwards (rendered by `npm run derive`).
  reverse: z.boolean().default(false),
  // With speed < 1: real slow motion by frame interpolation instead of repeating
  // frames (rendered by `npm run derive`). Best on 60 fps footage.
  smooth: z.boolean().default(false),
  // Steady a shaky handheld moment, gimbal-style (scripts/stab.swift: Vision registration,
  // smoothed camera path; zooms in just enough, 3-15%, to hide the moved edges).
  stabilize: z.boolean().default(false),
  // Low-resolution footage (e.g. a 720p action camera) prepared for enlarging, from the
  // original file: motion-interpolated to 60 fps, lightly denoised (the camera's
  // compression blocks), Lanczos-upscaled to the output height and sharpened (CAS)
  // (rendered by `npm run derive`). Still softer than native 4K; check keeps warning.
  enhance: z.boolean().default(false),
  // Brighten only the face (e.g. backlit by the sun): Vision face track, soft ellipse
  // weighted to skin colour, gamma 1/(1+faceLift) on it (scripts/facelift.py, rendered
  // by `npm run derive`). 0.5 is about a stop on a dark face.
  faceLift: z.number().min(0).max(1.5).default(0),
  // Painted, hand-drawn look (anime background painting): colour flattened by repeated
  // edge-preserving blurs, thin ink outlines, a soft bloom, mixed with the footage at this
  // strength (0.55 = half painted, faces and signs stay readable). Rendered by `npm run
  // derive` (videos: the clip's window; photos: a painted copy).
  paint: z.number().min(0).max(1).default(0),
  // Lights coming up through a video clip: a warm bloom on the highlights that grows from
  // `from` to `to` (screen strength 0-1) across the shot, e.g. lanterns as dusk falls
  // (rendered by `npm run derive`).
  glow: z.object({ from: z.number().min(0).max(1).default(0), to: z.number().min(0).max(1) }).optional(),
  // Slow mist drifting across the shot (amount = peak opacity), in a band centred at y
  // (fraction of the frame height), e.g. over a stream or a hillside.
  mist: z.object({ amount: z.number().min(0).max(1), y: z.number().min(0).max(1).default(0.6) }).optional(),
  // Per-clip colour: "none" for footage already graded elsewhere, or adjustments
  // layered on the reel's grade (e.g. { temperature: -0.1 } to match neighbours).
  grade: z.union([z.literal("none"), gradeAdjustSchema]).optional(),
  // Volume of the clip's own sound (0 = muted). Needs media prepared after 2026-10-12.
  sound: z.number().min(0).max(1).default(0),
  // transition "portal": the opening in the PREVIOUS shot (its final frame) that this shot
  // appears in: centre x/y, width/height as fractions of the frame; the top is an arch.
  // arch: false for a rectangular opening (a picture frame, a window).
  portal: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), arch: z.boolean().default(true) }).optional(),
  // transition "match": a shape in the previous shot (from) and the same kind of shape in
  // this one (to): centre x/y and radius r, fractions of the frame width/height (r of width).
  match: z
    .object({
      from: z.object({ x: z.number(), y: z.number(), r: z.number().positive() }),
      to: z.object({ x: z.number(), y: z.number(), r: z.number().positive() }),
    })
    .optional(),
  // transition "bloom" / "ripple": the point in the PREVIOUS shot it comes from (fractions).
  at: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  // Photo: 2.5D parallax. The subject (Vision cutout, `npm run derive`) is lifted off the
  // photo and grows `amount` more than the background over the clip, anchored at x/y
  // (its base), so a still moves like a dolly shot. e.g. { amount: 0.06, x: 0.5, y: 0.95 }
  parallax: z.object({ amount: z.number().min(0).max(0.2), x: z.number().min(0).max(1).default(0.5), y: z.number().min(0).max(1).default(0.95) }).optional(),
  // Photo: the shot arrives still moving and settles, carrying on the previous shot's
  // camera move across a dissolve (e.g. the camera starting to look down -> the tray
  // drifts up into place). Starts offset by x/y (fraction of the frame; positive = the
  // picture starts right/low and moves left/up), eases to rest over `beats`, and turns
  // `turn` degrees slowly over the whole clip (an overhead camera never quite stops).
  // The zoom needed to keep the frame covered is worked out automatically.
  settle: z.object({ x: z.number().min(-0.2).max(0.2).default(0), y: z.number().min(-0.2).max(0.2).default(0),
    beats: z.number().positive(), turn: z.number().min(-10).max(10).default(0) }).optional(),
  // Photo: 2.5D camera move from a depth map (Depth Anything V2, `npm run derive`): the
  // photo is cut into `layers` depth slices and pushed in toward x/y, nearer slices more
  // (`amount` = extra zoom of the nearest slice), like footage from a slider.
  // phone: use the depth the iPhone recorded with the photo instead of the estimate (true =
  // this photo's own; a file name = another raw photo of exactly the same frame, e.g. the
  // original of an edited JPG). rack: a focus pull across the depth, from depth `from` to
  // `to` (0 = the far plane, 1 = the nearest object), between fractions `start` and `end`
  // of the clip; layers off the focus plane blur by up to `blur` px, in proportion to
  // their distance from it in disparity, as a real lens does.
  depth3d: z.object({ amount: z.number().min(0).max(0.4).default(0.16), x: z.number().min(0).max(1).default(0.5), y: z.number().min(0).max(1).default(0.5),
    layers: z.number().int().min(3).max(16).default(10), base: z.number().min(0).max(0.2).default(0.04),
    phone: z.union([z.boolean(), z.string()]).default(false),
    rack: z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1), blur: z.number().min(0).max(40).default(12),
      start: z.number().min(0).max(1).default(0.2), end: z.number().min(0).max(1).default(0.75) }).optional() }).optional(),
  // Glaze transition (photos of painted ceramics): the area the colour is dabbed onto,
  // as fractions of the frame (the rest of the shot colours in afterwards).
  glaze: z.object({ x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1) }).optional(),
  // Deliberate exceptions to the editing rules in `npm run check`:
  //   flagged: uses frames review flagged (blur/shake), e.g. a real camera whip
  //   hold:    longer hold than the pacing rules allow
  //   split:   another clip continues this same take
  //   leadin:  starts on a still moment before the motion
  //   skin:    the "face" QA judges isn't skin (a painting, a statue); checked by eye
  //   upscale: low-resolution footage used on purpose (it is enlarged and
  //   looks softer); still reported as a warning with the factor, never silently
  allow: z.array(z.enum(["flagged", "hold", "split", "leadin", "skin", "upscale"])).default([]),
}).superRefine((c, ctx) => {
  if (c.ramp && (c.reverse || c.smooth || c.stabilize || c.enhance || c.faceLift > 0 || c.paint > 0 || !!c.glow))
    ctx.addIssue({ code: "custom", message: "ramp can't be combined with reverse/smooth/stabilize" });
  if (c.smooth && c.speed >= 1) ctx.addIssue({ code: "custom", message: "smooth needs speed < 1" });
  if (c.interpolate && (c.reverse || c.smooth || c.stabilize || c.enhance || c.faceLift > 0 || c.paint > 0 || !!c.glow))
    ctx.addIssue({ code: "custom", message: "interpolate can't be combined with reverse/smooth/stabilize" });
  if ((c.rampIn > 1 || c.rampOut > 1) && (c.reverse || c.smooth || c.stabilize || c.enhance || c.faceLift > 0 || c.paint > 0 || !!c.glow))
    ctx.addIssue({ code: "custom", message: "rampIn/rampOut can't be combined with reverse/smooth/stabilize" });
  if (c.freeze && (c.reverse || c.smooth || c.stabilize || c.enhance || c.faceLift > 0 || c.paint > 0 || !!c.glow))
    ctx.addIssue({ code: "custom", message: "freeze can't be combined with reverse/smooth/stabilize" });
  if (c.behind && /\.(mov|mp4|m4v|webm)$/i.test(c.src)) ctx.addIssue({ code: "custom", message: "behind is for photos" });
  if (c.parallax && /\.(mov|mp4|m4v|webm)$/i.test(c.src)) ctx.addIssue({ code: "custom", message: "parallax is for photos" });
  if (c.settle && /\.(mov|mp4|m4v|webm)$/i.test(c.src)) ctx.addIssue({ code: "custom", message: "settle is for photos" });
  if (c.depth3d && /\.(mov|mp4|m4v|webm)$/i.test(c.src)) ctx.addIssue({ code: "custom", message: "depth3d is for photos" });
  if (c.transition === "glaze" && /\.(mov|mp4|m4v|webm)$/i.test(c.src)) ctx.addIssue({ code: "custom", message: "the glaze transition is for photos" });
  if (c.transition === "sketch" && /\.(mov|mp4|m4v|webm)$/i.test(c.src)) ctx.addIssue({ code: "custom", message: "the sketch transition is for photos" });
  if (c.transition === "portal" && !c.portal) ctx.addIssue({ code: "custom", message: "transition portal needs portal: { x, y, w, h }" });
  if (c.transition === "match" && !c.match) ctx.addIssue({ code: "custom", message: "transition match needs match: { from, to }" });
  if ((c.transition === "bloom" || c.transition === "ripple") && !c.at) ctx.addIssue({ code: "custom", message: `transition ${c.transition} needs at: { x, y }` });
  // atBeat == beats freezes the last frame for a transition tail (e.g. a portal push).
  if (c.freeze && c.freeze.atBeat > c.beats) ctx.addIssue({ code: "custom", message: "freeze.atBeat must be inside the clip (or its end)" });
});

export const musicFileSchema = z
  .object({
    file: z.string().nullable(),
    source: z.string().nullable().default(null),
    bpm: z.number().positive(),
    firstBeat: z.number().min(0).default(0),
    suggestedStart: z.number().min(0).default(0),
    duration: z.number().min(0).default(0),
    // Set for library songs (music/<song>/): title, artist, and where the guide came from.
    title: z.string().optional(),
    artist: z.string().optional(),
    guideKind: z.enum(["recording", "preview", "file"]).optional(),
    // file guides: seconds into the reel where the track's drop lands (cue for Instagram).
    dropAt: z.number().optional(),
  })
  .passthrough();

// What `npm run media` measured about each prepared file (topics/<slug>/media.json).
export const mediaInfoSchema = z.object({
  w: z.number(),
  h: z.number(),
  fps: z.number(),
  duration: z.number(),
  audio: z.boolean(),
  hdr: z.boolean().default(false),
});

export const reelSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  // Big opening line, on screen for the first `hookBeats` beats.
  hook: z.string(),
  // Small caps place tag under the hook, e.g. "Chom Cafe · Chiang Mai".
  place: z.string(),
  // false = no place tag under the hook (Versailles, 2026-10-12: the small tag under every
  // title made the reels look templated). The exhale title never has one.
  placeTag: z.boolean().default(true),
  // How photo moves (push, pan, pull, parallax) run. eased: slow down towards the end
  // (default). continuous: constant speed through the cut, so a photo never comes to a
  // stop before the next shot (Versailles, 2026-10-12: the statue and the window
  // "zoom in and stop", breaking the flow).
  photoMoves: z.enum(["eased", "continuous"]).default("eased"),
  hookBeats: z.number().int().min(1).default(4),
  // How the hook is set. reveal: words rise in (serif). palace: French-luxury title in
  // Bodoni Moda; the hook splits at its first comma into a spaced-capitals title whose
  // letter spacing settles as it appears ("VERSAILLES") and an italic line beneath.
  // breath: wellness / slow places; the hook in Cormorant Garamond Light Italic, each
  // letter coming into focus out of a soft blur like a breath, place tag in thin Jost.
  // exhale: spa / slow places, set apart from the centred title + tag of the other reels:
  // lowercase light Jost in two staggered left-aligned lines (split at the comma), no
  // place tag; the letter spacing keeps widening the whole time it is on screen (a long
  // exhale), and it leaves like mist.
  // race: motorsport, energetic reels: the hook in Anton capitals, slanted forward like a
  // livery, the same face as the scene titles; each word drives in from the left on the
  // half-beat and they all drive off to the right at the end.
  // hand: craft / art places: the hook handwritten (Caveat), each line written on at
  // writing speed, slightly tilted like a note; no place tag.
  titleStyle: z.enum(["reveal", "palace", "breath", "exhale", "race", "hand", "shutter", "lift", "air", "lockup", "ink"]).default("reveal"),
  // Pacing rules `npm run check` applies (src/config.ts STYLES): calm cinematic
  // travel, or energetic for fast beat-cut reels to upbeat tracks.
  style: z.enum(["calm", "energetic"]).default("calm"),
  // auto = placed by `npm run layout` where the opening frames are calmest and
  // face-free (Apple Vision saliency). upper (27%) / center / lower (68%) override.
  // A number (0.2-0.72, fraction of frame height) sets the text centre exactly.
  hookPosition: z.union([z.enum(["auto", "upper", "center", "lower"]), z.number().min(0.2).max(0.72)]).default("auto"),
  // Optional closing line over the last clip.
  closing: z.string().nullable().default(null),
  // Same for the closing line: auto, or upper (24%) / center / lower (70%).
  closingPosition: z.union([z.enum(["auto", "upper", "center", "lower"]), z.number().min(0.18).max(0.74)]).default("auto"),
  clips: z.array(clipSchema).min(1),
  // Allow this reel below the project minimum length (src/config.ts) when the
  // footage can't fill it without repeats; check reports it as a warning.
  minSeconds: z.number().positive().optional(),
  // Pairs of source files that `npm run qa` flags as look-alikes but were checked by
  // eye and are different shots. QA still lists them as warnings, with the reason.
  // a / b: a file name, or "file@startAt" for one clip of a file (two shots of one long take).
  allowSimilar: z.array(z.object({ a: z.string(), b: z.string(), reason: z.string() })).default([]),
  music: z
    .object({
      // Seconds into the track to start. Defaults to the detected start.
      startAt: z.number().min(0).optional(),
      // Override detected tempo.
      bpm: z.number().positive().optional(),
      // Override the detected first beat (seconds into the guide), e.g. when the detector
      // locks onto the snare / hi-hat half a beat away from the kick the cuts should hit.
      firstBeat: z.number().min(0).optional(),
      // 0.89 = -1 dB headroom, so loud masters don't clip after Instagram re-encodes.
      volume: z.number().min(0).max(1).default(0.89),
      // A song from the library (music/<song>/, `npm run song`) instead of topics/<slug>/music/.
      song: z.string().optional(),
      // embed: the track is in the upload. instagram: the track is only a guide; the
      // Instagram copy is silent and you add the same audio in the app (sync card).
      mode: z.enum(["embed", "instagram"]).default("embed"),
    })
    .default({ volume: 0.89, mode: "embed" }),
  // Filled from topics/<slug>/music.json by the topic loader.
  track: musicFileSchema,
  // Filled from topics/<slug>/media.json (written by `npm run media`).
  media: z.record(z.string(), mediaInfoSchema).default({}),
  // Filled from topics/<slug>/tracks.json (written by `npm run derive` for scene text and
  // subject wipes): per clip, per output frame, scene motion and the subject cutout.
  tracks: z.record(z.string(), z.object({ frames: z.array(z.object({ c: z.number(), dx: z.number(), dy: z.number(), box: z.array(z.number()).nullable() })) })).default({}),
  // Filled from topics/<slug>/layout.json (written by `npm run layout`).
  layout: z.object({ hookY: z.number().optional(), closingY: z.number().optional() }).passthrough().default({}),
  // Renders without text; used by the layout step to see the bare frames.
  hideText: z.boolean().default(false),
  grade: z
    .object({
      warmth: z.number().min(0).max(0.3).default(0.07),
      contrast: z.number().min(0.8).max(1.3).default(1.06),
      saturation: z.number().min(0.6).max(1.4).default(1.05),
      grain: z.number().min(0).max(0.2).default(0.05),
      vignette: z.number().min(0).max(0.6).default(0.22),
      exposure: z.number().min(-2).max(2).default(0),
      temperature: z.number().min(-1).max(1).default(0),
      tint: z.number().min(-1).max(1).default(0),
      // Film look (a colourist's base grade), applied after the adjustments above:
      //   curve  S-curve strength (contrast in the mids, soft toe and shoulder)
      //   fade   black lift (0.02-0.05 = a filmic, not crushed, black)
      //   roll   highlight roll-off (whites ease toward this much below pure white)
      //   split  split-toning amount: shadows toward `shadows`, upper mids (skin) toward `highlights`
      film: z.object({
        curve: z.number().min(0).max(1).default(0.35),
        fade: z.number().min(0).max(0.1).default(0.03),
        roll: z.number().min(0).max(0.1).default(0.03),
        split: z.number().min(0).max(1).default(0.5),
        // lift  opens up the lower mids (where darker skin sits) without lifting black
        // deep  the shadow tint only reaches levels below this (1 = all the way up to white)
        lift: z.number().min(0).max(0.3).default(0),
        deep: z.number().min(0.1).max(1).default(1),
        shadows: z.string().default("#1f5f6b"),
        highlights: z.string().default("#f0b36e"),
      }).optional(),
    })
    .default({ warmth: 0.07, contrast: 1.06, saturation: 1.05, grain: 0.05, vignette: 0.22, exposure: 0, temperature: 0, tint: 0 }),
});

export type ReelInput = Omit<z.input<typeof reelSchema>, "track" | "layout" | "hideText" | "media" | "tracks">;
export type Reel = z.output<typeof reelSchema>;
export type Clip = z.output<typeof clipSchema>;
export type Motion = z.output<typeof motionSchema>;
export type Transition = z.output<typeof transitionSchema>;
