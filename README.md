# Jauntcut

Turn raw phone footage into beat-cut travel reels (1080x1920, 30 fps) that look
hand-edited, not templated.

- **Edits are code.** Each reel is one `reel.ts` file: clips, lengths in beats, speed,
  transitions, grade and title style. A Zod schema validates it before anything renders.
- **On-device vision.** Small Swift tools run Apple Vision and Core ML locally for subject
  cutouts, depth, saliency, faces, on-screen text, visual similarity and stabilisation.
  No footage leaves the machine.
- **Quality gates.** Every render runs derive -> layout -> check -> QA -> render -> QA and
  stops at the first failure: repeated scenes, text over faces, skin tones, clipped
  highlights, loudness, frozen frames, file spec and leftover metadata.
- **One system, many looks.** 11 title styles and 15 transitions besides the plain cut, each driven by something
  in the footage (a doorway, a camera whip, a light) rather than stock app effects.

Built with Remotion 4, React 19, TypeScript, Swift, Python (NumPy, Pillow) and ffmpeg.

## How it works

```
inbox/ --sort--> topics/<slug>/raw --media--> public/<slug> --review--> frame strips, scores
                                                   |
                       topics/<slug>/reel.ts  <----+  (you write the edit)
                                                   |
   derive (depth, cutouts, stabilised and slowed clips) -> layout (text placement)
   -> check -> qa --pre -> render (Remotion) -> Instagram copy -> qa --post
```

## Requirements

- macOS on Apple Silicon with the Xcode command-line tools (`swiftc`), for the analysis steps
- Node 20 or newer
- ffmpeg and ffprobe (`brew install ffmpeg`)
- Python 3 with NumPy and Pillow (`pip3 install numpy pillow`)

| Works on | Commands |
| --- | --- |
| Any OS, once media is prepared | `npm run studio`, `npm run check`, `npm run typecheck`, `npm run peek` |
| macOS only | `sort`, `media`, `review`, `derive`, `layout`, `qa`, `render`, `timing-test` |

The macOS-only steps use Apple Vision, Core ML, `sips` and `avconvert`. Each Swift tool
reads files and writes JSON or PNG, so a Linux version of any one step can replace it
without touching the rest.

## Setup

```bash
npm ci                        # also generates src/topics.generated.ts
cp places.example.json places.json   # known places for the GPS sorter (optional)
```

For 3D moves on photos (`depth3d`), download Apple's Core ML build of Depth Anything V2
Small, `DepthAnythingV2SmallF16.mlpackage`, from
[apple/coreml-depth-anything-v2-small](https://huggingface.co/apple/coreml-depth-anything-v2-small)
into `.cache/models/`. Everything else needs no model download.

Your own topics, footage, music and `places.json` are git-ignored; only `topics/_template`
is part of the project.

## Workflow

```bash
npm run sort                  # inbox/ -> topics/<place>/raw by GPS and time
                              # inbox/<topic>/ forces that topic, GPS ignored
npm run sort -- --dry         # show the plan without moving anything
npm run sort -- --undo        # put the last batch back in inbox/
npm run rename-topic new-2026-10-12-1 night-market
npm run new night-market      # or create a topic by hand
npm run review night-market   # frame strips, blur/shake, activity, internal cuts, burned-in text
# put media in raw/, a track in music/, write the clip list in reel.ts
npm run media night-market    # convert media, analyse the beat
npm run studio                # preview and tweak
npm run render night-market   # checks, then renders out/night-market.mp4
```

`npm run media all` / `npm run render all` do every topic.

Once a reel is posted: `npm run post-topic <slug>` moves its topic, raw footage, media,
review, delivered files, earlier versions, QA sheets and regression frames to
`posted/<slug>/` (nothing is deleted); it no longer renders or regresses.

## Trending / Instagram audio

You add the real sound in Instagram; the reel is cut to a guide copy of it.

```bash
npm run song -- search "funkytown lipps"        # find it (metadata only)
npm run song -- add 1440894579 funkytown        # save to music/funkytown/
# In Instagram: open the trending reel's sound -> Use audio. Start a screen
# recording, THEN press play on the sound. AirDrop it to inbox/_audio/.
npm run song -- guide funkytown inbox/_audio/rec.mov   # exact snippet, beats
```

Then in the topic's `reel.ts`: `music: { song: "funkytown", mode: "instagram" }`.
`npm run render` cuts to the guide's beats; `out/<slug>.mp4` keeps the guide audio
for checking, `out/instagram/<slug>.mp4` has NO audio, and
`out/instagram/<slug>-audio.txt` says how to add and line up the sound.
(`npm run song -- preview <slug>` uses Apple's 30 s preview instead; it's a
download, and Instagram's snippet may start elsewhere, so alignment is by ear.)

## Editing tools (per clip in reel.ts)

| want | write |
|---|---|
| trim | `startAt` + `beats` |
| speed / ramp | `speed: 1.5`, `ramp: { atBeat: 2, speed: 2 }` |
| real slow motion | `speed: 0.5, smooth: true` (interpolated) |
| reverse | `reverse: true` |
| steady a shaky moment | `stabilize: true` |
| transition in | `transition: "dissolve" \| "dip-black" \| "dip-white" \| "zoom" \| "blur" \| "whip"` |
| colour | `grade: { exposure: 0.3, temperature: -0.2, tint: 0.1 }`, or `grade: "none"` for footage graded elsewhere |
| one look across the reel | `python3 scripts/grade_match.py <slug>`: measures every clip and prints per-clip `grade` suggestions; advisory, keep each place's real tone |
| its own sound | `sound: 0.6` |
| whip that follows the pan | `transition: "whip", transitionDir: "right"` (way the picture moves; gap-free, motion-blurred) |
| glitch cut | `transition: "glitch"` (red/blue split + jitter; avoid: reads as an app template) |
| zoom punch on every beat | `pulse: 0.04` |
| impact shake | `shake: 1, shakeAtBeat: 0` |
| freeze frame (push-in) | `freeze: { atBeat: 4 }` (holds from that beat to the clip end) |
| palace title (French luxury) | reel-level `titleStyle: "palace"`: hook splits at its comma into spaced Bodoni Moda capitals that settle ("VERSAILLES") and an italic line |
| portal transition | `transition: "portal", portal: { x, y, w, h }`: the next shot fades in inside a soft-edged, arch-topped opening of the previous shot (a doorway) and the camera pushes through without ever slowing; the next shot keeps moving forward (ends 1.1x closer) and the rest of the frame dissolves in at the end (a hard pop, an ease-in pause and a settle-back stop read as a jump) |
| push into a portal | `motion: "push-into"` with `focal` on the doorway: zoom that moves from the first frame and keeps accelerating (1.6x over the clip and its transition), so it builds into the portal as one move (a steady zoom then a fast portal felt like two moves); re-measure the portal box at the cut (the door is bigger). Time the portal to whole beats (`transitionSeconds` = 2 beats): 0.8 s rushed a 91 BPM song |
| no place tag under the title | reel-level `placeTag: false` (Versailles; the exhale title never has one) |
| photo moves that never stop | reel-level `photoMoves: "continuous"`: pushes, pans, pulls and parallax run at constant speed through the cut instead of easing to a stop (Versailles). Standard when cutting on motion |
| light bloom transition | `transition: "bloom", at: { x, y }`: a light in the previous shot swells to fill the frame and this shot emerges from the glow (rejected on the spa reel: reads as an app effect) |
| water ripple transition | `transition: "ripple", at: { x, y }`: this shot spreads out from a point (water) behind a soft rippling wavefront (rejected on the spa reel: reads as an app effect) |
| frame portal | `portal: { ..., arch: false }` for a rectangular opening (a painting, a window); give the previous clip `freeze: { atBeat: <its beats> }` so it holds still while the camera pushes in. Only where the story goes through the opening: the spa painting -> tray portal read as an effect with no meaning |
| 2.5D parallax on a photo | `parallax: { amount: 0.06, x: 0.5, y: 0.95 }`: the subject (Vision cutout) lifts off the photo and moves a little faster than the background |
| 3D camera move on a photo (depth) | `motion: "still", depth3d: { amount: 0.18, x, y }`: a depth map (Depth Anything V2 Small, Apple's Core ML build in `.cache/models`, `scripts/depth.swift`) cuts the photo into slices; nearer slices push in faster, like a slider shot. Far depth (sky) is one flat plane (slicing it streaked the clouds). Use where Vision's subject cutout picks the wrong thing |
| Real iPhone depth | `depth3d: { ..., phone: true }` (or the file name of the unedited original of an edited photo): uses the depth the iPhone recorded with the photo (`scripts/phonedepth.swift`) instead of the estimate. Portrait/dual-camera HEICs carry it; measured, not guessed |
| Rack focus (photo) | `depth3d: { ..., rack: { from, to, blur, start, end } }`: focus pulls from depth `from` to `to` (0 = far plane, 1 = nearest) between those fractions of the clip; each depth slice blurs in proportion to its distance from the focus plane (Versailles: statue -> palace) |
| title standing behind the subject of a photo | `behind: { text: "FULL THROTTLE", y: 0.54, size: 80, color: "#C83A46" }` (colour sampled from the photo reads and matches better than white over a light background) (Vision cutout; y = ground line the letters rise out of, before `zoom`) |
| text set into the scene (video) | `scene: { text: "CHIANG MAI", x: 0.5, y: 0.8, size: 180, atBeat: 0.5 }`: motion-tracked to the ground it stands on, letters rise out of the ground line (`sinkAtBeat` sinks them back; `followX: 0` keeps it centred on screen while the camera pans), moving subjects pass in front (per-frame Vision cutouts); `erase: true` = the subject wipes the letters away as it drives through |
| smooth a 30 fps clip | `interpolate: true` (motion-interpolated 60 fps copy for ramps). Very fast pans tear: there, play real frames at 2x or 1x (even cadence on 60 fps). Slow motion: 0.5x on 60 fps, not 0.75x |
| subject wipe | `transition: "subject-wipe"`: the next shot opens behind the previous shot's moving subject (rejected on the circuit reel: read as a frame wipe) |
| speed ramp into / out of a whip | `rampOut: 3` on the clip before, `rampIn: 2.5` on the clip after (`rampBeats`, default 0.75) |
| breath title (spa, wellness) | reel-level `titleStyle: "breath"`: hook in light Cormorant Garamond italic, letters come out of a blur one by one like a slow exhale, small widely spaced Jost tag under it |
| exhale title (spa) | reel-level `titleStyle: "exhale"`: lowercase light Jost in two staggered left-aligned lines split at the comma, no place tag; letter spacing widens the whole time (a long exhale), leaves like mist. Breaks the centred title + tag layout every other reel uses |
| race title (motorsport) | reel-level `titleStyle: "race"`: hook in Anton capitals slanted like livery lettering; each word drives into its own slot on the half-beat and they drive off right at the end (circuit) |
| hand title (art / craft places) | reel-level `titleStyle: "hand"`: hook handwritten in Caveat, each line written on at writing speed, slightly tilted, no place tag (Artistic Village) |
| sketch-to-paint transition (photos) | `transition: "sketch", transitionSeconds: 0.96`: paper fades over the previous shot, a pencil sketch of the photo draws itself (strongest lines first; `scripts/sketch.py` via derive), then colour blooms out from `focal` like a watercolour wash. Use at 1-2 meaningful moments, not every cut, and only where drawing/painting is the story (it was wrong after the ceramic painters) |
| glaze transition (painted ceramics) | `transition: "glaze", glaze: { x0, y0, x1, y1 }`: the photo arrives unpainted (pale grey, like white bisque) and colour is dabbed on in soft round touches across the glaze area, then the rest colours in (Artistic Village: painters -> their ceramics board) |
| real motion blur on a moving title | race titles get it automatically: Remotion's `HtmlInCanvasMotionBlur` (`@remotion/motion-blur`, experimental; 12 samples, 180-degree shutter). Keep shadows outside the blurred layer (they leave boxes inside it) |
| graphic match cut | `transition: "match", match: { from: { x, y, r }, to: { x, y, r } }`: a round shape in the previous shot (a chandelier) is held on the same spot as a round shape in this one (a foot bath) while one dissolves into the other, then the frame glides to this shot's own framing |
| light-order dissolve | `transition: "luma"`: the previous shot gives way brightest areas first, so this shot seeps in through the highlights (soft, for calm reels; 1.2-1.4 s) |
| photo that arrives moving | `settle: { x: 0.08, y: 0.05, beats: 3.5, turn: 4 }`: across a dissolve, the photo carries on the previous shot's real camera move (starts offset, lands with a fast-to-soft ease) and keeps turning slowly overhead; cover zoom is automatic per frame (eases off as it lands) and counted in the upscale check. Match the direction to the outgoing shot's drift (spa: the camera turning down from the painting -> the tray drifts up-left) |
| shutter title (a window shot) | reel-level `titleStyle: "shutter"`: upright Cormorant Garamond; the words open from the centre outward like shutters parting, and leave by growing and softening as the camera carries on through them (tree house) |
| lift title (flying, take-offs) | reel-level `titleStyle: "lift"`: Inter capitals rising into place left to right with a small overshoot, like a wing inflating; at the end they keep rising out of frame (paramotoring) |
| air title (flying, soaring music) | reel-level `titleStyle: "air"`: thin Jost capitals, widely spaced, set in the sky; letters come out of blur from the centre outward, the line drifts up as its spacing opens, and dissolves back into blur at the end (paramotoring, replacing "lift") |
| lockup title (film-title lockup) | reel-level `titleStyle: "lockup"`: first word in small spaced Inter caps over the rest in a large Instrument Serif italic; the small word settles in, the big letters rise out of blur, the lockup lifts and fades at the end (paramotoring) |
| ink title (old villages, Asian mood) | reel-level `titleStyle: "ink"`: hook in Yuji Syuku brush lettering, written on left to right behind a ragged brush edge while the ink settles, then a vermilion seal with the place's city stamps beside it (Mae Kampong) |
| painted look (anime background painting) | clip `paint: 0.55`: colour flattened by edge-preserving blurs, thin ink lines, soft bloom, mixed with the footage at that strength; rendered by `npm run derive` (Mae Kampong) |
| lanterns coming up | clip `glow: { from, to }` (videos): a warm bloom on the highlights that grows across the shot, rendered by `npm run derive` |
| drifting mist | clip `mist: { amount, y }`: two layers of soft noise drifting sideways in a feathered band at height y; carries on across cuts |
| footage wider than 9:16 (GoPro) | `reframe: { x0, x1 }`: the crop's centre glides across the frame at constant speed; aim it off the rider onto the view, or shots from a boom-mounted camera all look alike |
| cut to the song's structure | find the drop (bass-band onset) in the full song, start the guide so the key moment lands on it (`npm run song -- file <slug> <file> --start S --drop S`), and start it exactly on a beat (firstBeat 0): cuts are offset by firstBeat in Instagram mode. Paramotoring: the lift-off on the drop at 1:20.02, the reel on 1:12.8-1:45.0 |
| no opening title | `hook: ""`: no text and no darkened band |
| two look-alike shots of one long take | `allowSimilar: [{ a: "FILE@startAt", b: "FILE@startAt", reason }]` names single clips of one file; QA still lists them as warnings with the reason |
| cinema grade (film look) | reel-level `grade: { ..., film: { curve, fade, roll, split, shadows, highlights } }`: filmic S-curve with lifted blacks and white roll-off, teal shadows and warm upper mids (skin) by split toning; skies keep their colour. Paramotoring: `curve 0.7, fade 0.04, roll 0.04, split 1.0, lift 0.15, deep 0.45` (`lift` opens the lower mids so darker skin is not pulled into shadow; `deep` keeps the teal in true shadows). Check faces graded vs ungraded. Footage that arrives already graded gets a per-clip `grade: { saturation, exposure }` to sit with the rest |
| low-resolution footage you choose to keep | list the file in `topics/<slug>/lowres.txt` (media prepares it at its own size instead of skipping it) and give its clips `allow: ["upscale"]` (check reports the enlargement as a warning with the factor) |

Reverse / smooth / stabilise are pre-rendered by `npm run derive` (the render runs it).

Pacing per reel: `style: "calm"` (default, cinematic) or `style: "energetic"` (fast
beat cuts: shorter shots allowed, shorter holds required). Limits in `src/config.ts`.

## Footage edited before it arrives

Works like raw footage. Drop it in `inbox/<topic>/` (exports usually lose GPS).
`npm run review` finds cuts inside a file (shots never span them) and burned-in
captions/watermarks; HDR exports are converted to SDR; 1080x1920 exports are held
still automatically (no room to zoom without upscaling); use `grade: "none"` if
it's already graded.

## Quick checks while editing

- `npm run peek <slug> 7.5 12.2 | 5.6-7.9 | clip:4 [text]`: labelled frames of any moments
  in a few seconds (out/qa/<slug>-peek.jpg), instead of a full render.
- `npm run regress -- compare <slug>`: only the reels you name (a full check of every reel takes longer).
- `python3 scripts/grade_match.py <slug>`: measures each clip's colour against the reel and
  prints suggestions only (applying them wholesale flattened the circuit reel: judge by eye).

## Safety nets

- `npm run regress -- save|compare`: renders 1 frame/s of every reel; proves an
  engine change didn't alter existing reels.
- `npm run timing-test`: exact frame-number test of speed, ramps, reverse, slow-mo.
- `npm run qa <slug> --pre` also checks the picture: burnt-out highlights (over 3% of
  the frame) and crushed blacks (over 10%) per clip, and skin tones on every real face
  (vectorscope hue within 123+-12 deg, not over-saturated, not in shadow or burnt out).
  A face that isn't skin (a painting) is marked `allow: ["skin"]` and still listed.
- `npm run check` also checks reading speed: on-screen text at most 17 characters/s.

## Rules the scripts enforce

- Originals in `raw/` are never modified.
- HEIC becomes sRGB JPG. Video becomes H.264 SDR bt709. HDR video is flagged
  and skipped if this ffmpeg can't tone-map it.
- Nothing is upscaled: media under 1080x1920 is skipped, and `npm run check`
  fails if a crop or zoom would enlarge a source past 1:1.
- Every cut lands on a beat of the track. `npm run check` also fails if a clip
  runs past the end of its video or the music is too short.
- Export: h264, crf 14, yuv420p, bt709, JPEG frames at quality 100.

## License

Code: MIT, see [LICENSE](LICENSE). Fonts in `public/fonts/` are under the SIL Open Font
License 1.1 (texts in `public/fonts/licenses/`). Remotion has its own license: free for
individuals and small teams, a company license above that; see
[remotion.dev/license](https://remotion.dev/license). No music is included.
