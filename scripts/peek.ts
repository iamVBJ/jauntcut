// Quick look at any moments of a reel without rendering it: one browser for all frames.
//   npm run peek <slug> 5.6 7.9 12.2        frames at these seconds
//   npm run peek <slug> 5.6-7.9             a range, 8 frames across it
//   npm run peek <slug> clip:4              start / middle / end of clip 4 (1-based)
//   add `text` to include the hook / closing text (hidden by default, like QA). Through npm
//   use the word, not --text: npm swallows --flags that come before `--`.
// Writes out/qa/<slug>-peek.jpg, a labelled contact sheet. Takes seconds, not minutes.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { makeBundle } from "./bundle";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { FPS, clipStarts, totalFrames } from "../src/lib";

(async () => {
  const [slug, ...rest] = process.argv.slice(2);
  const t = topics.find((x) => x.slug === slug);
  if (!t) throw new Error(`no topic ${slug}`);
  const withText = rest.includes("--text") || rest.includes("text");
  const reel = reelSchema.parse({ ...t, hideText: !withText });
  const starts = clipStarts(reel);
  const last = totalFrames(reel) - 1;
  const frames: number[] = [];
  for (const a of rest.filter((x) => !x.startsWith("--") && x !== "text")) {
    if (a.startsWith("clip:")) {
      const s = starts[Number(a.slice(5)) - 1];
      if (!s) throw new Error(`no ${a}`);
      frames.push(s.from + 1, s.from + Math.round(s.frames / 2), s.from + s.frames - 2);
    } else if (a.includes("-")) {
      const [x, y] = a.split("-").map(Number);
      for (let k = 0; k < 8; k++) frames.push(Math.round((x + ((y - x) * k) / 7) * FPS));
    } else frames.push(Math.round(Number(a) * FPS));
  }
  if (!frames.length) throw new Error("usage: npm run peek <slug> <seconds | a-b | clip:N> ... [text]");
  const serveUrl = await makeBundle();
  const browser = await openBrowser("chrome");
  const comp = await selectComposition({ serveUrl, id: slug, inputProps: reel, puppeteerInstance: browser });
  const dir = join(".cache/peek", slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const f of frames.map((x) => Math.max(0, Math.min(last, x)))) {
    const out = join(dir, `${String(f).padStart(5, "0")}.jpeg`);
    await renderStill({ composition: comp, serveUrl, output: out, frame: f, inputProps: reel, imageFormat: "jpeg", scale: 0.3, puppeteerInstance: browser });
    files.push(out);
  }
  await browser.close({ silent: true });
  mkdirSync("out/qa", { recursive: true });
  const sheet = join("out/qa", `${slug}-peek.jpg`);
  execFileSync("python3", ["scripts/peek_sheet.py", sheet, String(FPS), ...files], { stdio: "inherit" });
})();
