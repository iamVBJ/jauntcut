// Places the hook and closing text where they cover the least of the picture.
// Renders the real composed frames with text hidden (every 0.2 s through the hook,
// every 0.3 s through the closing shot), asks Apple Vision (scripts/saliency.swift)
// what matters in each - attention, distinct objects, small details in plain areas
// like a plane in the sky, faces - and picks the text height whose WORST moments
// (90th percentile over frames) cover the least, inside Instagram's safe zones.
// Writes topics/<slug>/layout.json. Usage: npm run layout <slug>|all
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeBundle } from "./bundle";
import { renderStill, selectComposition } from "@remotion/renderer";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { SAFE, TEXT_BOX, WIDTH, beatFrame, clipStarts, hookEndFrame, textRange, textY } from "../src/lib";

const HELPER = ".cache/saliency";
const FACE_WEIGHT = 4; // a face under text costs far more than busy background
const WORST = 0.9; // percentile over frames: anything on screen ~1/3 s or more counts fully
const HOOK_STEP = 0.2; // seconds between sampled frames
const CLOSE_STEP = 0.3;

type Sal = { grid: number[][]; objects?: number[][]; detail?: number[][]; faces: number[][] };

// Importance of each cell: attention or a small detail in a plain area (a plane in
// the sky), whichever is stronger. Vision's objectness is NOT used: on travel
// footage it marks the whole foreground (lawn, plants, cobbles) as the object and
// pushes text onto the architecture and sky, which are the real subjects.
const importance = (f: Sal) =>
  f.grid.map((row, r) => row.map((v, c) => Math.max(v, f.detail?.[r]?.[c] ?? 0)));

const ensureHelper = () => {
  const src = "scripts/saliency.swift";
  if (!existsSync(HELPER) || statSync(HELPER).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(".cache", { recursive: true });
    execFileSync("swiftc", ["-O", src, "-o", HELPER], { stdio: "inherit" });
  }
};

// Cost of a text box centred at y with height h: per frame, the mean importance
// under the box plus faces; across frames, the WORST percentile.
const cost = (frames: Sal[], y: number, h: number) => {
  const x0 = SAFE.right / WIDTH;
  const x1 = 1 - SAFE.right / WIDTH;
  const y0 = y - h / 2;
  const y1 = y + h / 2;
  const per: number[] = [];
  for (const f of frames) {
    const imp = importance(f);
    const rows = imp.length;
    const cols = imp[0].length;
    let s = 0;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      const ry0 = r / rows;
      const ry1 = (r + 1) / rows;
      const oy = Math.max(0, Math.min(y1, ry1) - Math.max(y0, ry0)) * rows;
      if (oy <= 0) continue;
      for (let c = 0; c < cols; c++) {
        const cx0 = c / cols;
        const cx1 = (c + 1) / cols;
        const ox = Math.max(0, Math.min(x1, cx1) - Math.max(x0, cx0)) * cols;
        if (ox <= 0) continue;
        s += imp[r][c] * ox * oy;
        n += ox * oy;
      }
    }
    let face = 0;
    for (const [fx, fy, fw, fh] of f.faces) {
      // Grow face boxes by 25% so text doesn't touch hair or chin.
      const gx0 = fx - fw * 0.25, gx1 = fx + fw * 1.25, gy0 = fy - fh * 0.25, gy1 = fy + fh * 1.25;
      const ov = Math.max(0, Math.min(x1, gx1) - Math.max(x0, gx0)) * Math.max(0, Math.min(y1, gy1) - Math.max(y0, gy0));
      face += ov / ((gx1 - gx0) * (gy1 - gy0));
    }
    per.push((n ? s / n : 0) + FACE_WEIGHT * face);
  }
  per.sort((a, b) => a - b);
  return per[Math.min(per.length - 1, Math.floor(WORST * (per.length - 1) + 0.5))];
};

const place = (frames: Sal[], h: number) => {
  const [lo, hi] = textRange(h);
  let best = { y: 0.5, c: Infinity };
  for (let y = lo; y <= hi + 1e-9; y += 0.01) {
    const c = cost(frames, y, h) + 0.005 * Math.abs(y - 0.5); // ties go to the middle
    if (c < best.c) best = { y, c };
  }
  return { y: Math.round(best.y * 1000) / 1000, cost: Math.round(cost(frames, best.y, h) * 1000) / 1000, centerCost: Math.round(cost(frames, 0.5, h) * 1000) / 1000 };
};

const main = async () => {
  const target = process.argv[2] ?? "all";
  const chosen = topics.filter((t) => target === "all" || t.slug === target);
  if (!chosen.length) throw new Error(`no topic ${target}`);
  ensureHelper();
  const serveUrl = await makeBundle();
  const dir = ".cache/layout";
  mkdirSync(dir, { recursive: true });
  const sheets: object[] = [];
  for (const t of chosen) {
    const reel = reelSchema.parse({ ...t, layout: {}, hideText: true });
    const inputProps = { ...reel };
    const comp = await selectComposition({ serveUrl, id: reel.slug, inputProps });
    const starts = clipStarts(reel);
    const hookEnd = hookEndFrame(reel);
    const last = starts[starts.length - 1];
    const fps = comp.fps;
    const hookFrames: number[] = [];
    for (let f = 0; f < hookEnd; f += Math.round(fps * HOOK_STEP)) hookFrames.push(f);
    const closeFrames: number[] = [];
    for (let f = last.from + Math.round(fps * 0.2); f < last.from + last.frames; f += Math.round(fps * CLOSE_STEP)) closeFrames.push(f);
    const shots: Record<string, string> = {};
    for (const f of [...hookFrames, ...closeFrames]) {
      const out = join(dir, `${reel.slug}-${f}.jpeg`);
      await renderStill({ composition: comp, serveUrl, output: out, frame: f, inputProps, imageFormat: "jpeg", scale: 0.25 });
      shots[f] = out;
    }
    const sal: Record<string, Sal> = {};
    const lines = execFileSync(HELPER, Object.values(shots)).toString().trim().split("\n");
    for (const l of lines) {
      const j = JSON.parse(l);
      if (j.error || !j.grid) throw new Error(`saliency failed for ${j.file}: ${j.error}`);
      sal[j.file] = j;
    }
    const hook = place(hookFrames.map((f) => sal[shots[f]]), TEXT_BOX.hook);
    const closing = place(closeFrames.map((f) => sal[shots[f]]), TEXT_BOX.closing);
    writeFileSync(join("topics", reel.slug, "layout.json"), JSON.stringify({ hookY: hook.y, closingY: closing.y, detail: { hook, closing } }, null, 2) + "\n");
    // Text-placement sheet for the by-eye review: frames with the final text boxes drawn.
    const final = reelSchema.parse({ ...t, layout: { hookY: hook.y, closingY: closing.y } });
    // Score the positions actually used (a reel may override auto with a checked value).
    const used = {
      hook: { y: textY(final, "hook"), cost: Math.round(cost(hookFrames.map((f) => sal[shots[f]]), textY(final, "hook"), TEXT_BOX.hook) * 1000) / 1000 },
      closing: { y: textY(final, "closing"), cost: Math.round(cost(closeFrames.map((f) => sal[shots[f]]), textY(final, "closing"), TEXT_BOX.closing) * 1000) / 1000 },
    };
    writeFileSync(join("topics", reel.slug, "layout.json"), JSON.stringify({ hookY: hook.y, closingY: closing.y, detail: { hook, closing }, used }, null, 2) + "\n");
    sheets.push({ slug: reel.slug, hook: hookFrames.map((f) => shots[f]), close: closeFrames.map((f) => shots[f]), hookY: textY(final, "hook"), closingY: textY(final, "closing"), closing: !!reel.closing });
    console.log(
      `${reel.slug.padEnd(22)} hook at ${(hook.y * 100).toFixed(0)}% (cost ${hook.cost}, centre would be ${hook.centerCost})  ` +
        `closing at ${(closing.y * 100).toFixed(0)}% (cost ${closing.cost}, centre ${closing.centerCost})`,
    );
  }
  execFileSync("npx", ["tsx", "scripts/topics.ts"], { stdio: "ignore" });
  writeFileSync(join(dir, "sheets.json"), JSON.stringify(sheets));
  execFileSync("python3", ["scripts/text_sheet.py", join(dir, "sheets.json")], { stdio: "inherit" });
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
