// Prints, as JSON, which source moment every video clip should show at sampled
// output times. Used by scripts/timing_test.py to check the render.
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { FPS, beatFrame, clipStarts, isVideo, preparedPath } from "../src/lib";

const reel = reelSchema.parse(topics.find((t) => t.slug === process.argv[2]));
const starts = clipStarts(reel);
const samples: { out: number; src: string; expect: number; clip: number }[] = [];
reel.clips.forEach((c, i) => {
  if (!isVideo(c.src)) return;
  const { from, frames } = starts[i];
  const at = c.ramp ? Math.min(beatFrame(reel, c.ramp.atBeat), frames) : frames;
  // Sample inside the clip, away from cut and whip edges.
  for (let f = Math.round(frames * 0.15); f < frames * 0.9; f += Math.max(1, Math.round(frames / 6))) {
    const srcFrames = f <= at ? f * c.speed : at * c.speed + (f - at) * (c.ramp?.speed ?? c.speed);
    samples.push({ out: (from + f) / FPS, src: preparedPath(reel.slug, c.src), expect: c.startAt + srcFrames / FPS, clip: i + 1 });
  }
});
console.log(JSON.stringify(samples));
