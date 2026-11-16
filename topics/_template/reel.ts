import type { ReelInput } from "../../src/schema";

// One reel. Clip src = file name in raw/. Lengths are in beats of the track.
// Options per clip: beats, startAt (s), speed, ramp {atBeat, speed},
// focal {x, y} (0-1), zoom, motion (push-in | pull-out | pan-left |
// pan-right | pan-up | pan-down | still), whip (whip-pan into this clip).
export const reel: ReelInput = {
  slug: "__SLUG__",
  hook: "Your opening line",
  place: "Place · City",
  closing: null,
  // hookPosition / closingPosition: "auto" (default, placed by npm run layout) or upper | center | lower
  clips: [
    // { src: "IMG_0001.mov", beats: 2 },
  ],
};
