// Renders bare (text hidden) frames at 10/50/90% of every clip of a reel into
// .cache/qa/<slug>/c<NN>_<k>.jpeg and prints the clip list as JSON. Used by qa.py.
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeBundle } from "./bundle";
import { renderStill, selectComposition } from "@remotion/renderer";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { FPS, clipStarts, isVideo, transitionFrames, transitionOf } from "../src/lib";

(async () => {
  const slug = process.argv[2];
  const reel = reelSchema.parse({ ...topics.find((t) => t.slug === slug), hideText: true });
  const serveUrl = await makeBundle();
  const comp = await selectComposition({ serveUrl, id: slug, inputProps: reel });
  const dir = join(".cache/qa", slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const starts = clipStarts(reel);
  const clips = [];
  for (const [i, s] of starts.entries()) {
    const files = [];
    // Sample after this shot's incoming transition (dissolves, matches, portals blend two
    // shots and would read as a repeated scene), spread over what is left.
    const c0 = reel.clips[i];
    const skip = i > 0 && transitionOf(c0) !== "cut" ? Math.min(transitionFrames(c0), Math.floor(s.frames * 0.6)) : 0;
    for (const [k, p] of [0.1, 0.5, 0.9].entries()) {
      const f = s.from + skip + Math.round((s.frames - skip) * p);
      const out = join(dir, `c${String(i + 1).padStart(2, "0")}_${k}.jpeg`);
      await renderStill({ composition: comp, serveUrl, output: out, frame: f, inputProps: reel, imageFormat: "jpeg", scale: 0.25 });
      files.push(out);
    }
    const c = reel.clips[i];
    clips.push({ n: i + 1, src: c.src, video: isVideo(c.src), startAt: c.startAt, from: s.from / FPS, to: (s.from + s.frames) / FPS, files, allow: c.allow });
  }
  console.log(JSON.stringify({ clips, allowSimilar: reel.allowSimilar }));
})();
