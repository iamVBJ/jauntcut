// Regression guard: renders one frame per second of every reel (quarter size)
// and either saves them as the baseline or compares against it, so engine changes
// can be proven not to alter existing reels.
// Each frame renders on its own (no shared browser): a shared browser renders text and
// video frames very slightly differently, and the baseline must use the same method.
// Usage: npm run regress -- save | compare [slug ...]
//   with slugs, only those reels are rendered (save updates just their baseline frames).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeBundle } from "./bundle";
import { renderStill, selectComposition } from "@remotion/renderer";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { FPS, totalFrames } from "../src/lib";

const mode = process.argv[2];
if (mode !== "save" && mode !== "compare") throw new Error("usage: regress save|compare [slug ...]");
const only = process.argv.slice(3);
const chosen = topics.filter((t) => !only.length || only.includes(t.slug));
if (only.length && chosen.length !== only.length) throw new Error(`unknown reel in: ${only.join(", ")}`);
const dir = ".cache/regress";
const base = join(dir, "baseline.json");
(async () => {
  const serveUrl = await makeBundle();
  mkdirSync(join(dir, mode), { recursive: true });
  const hashes: Record<string, string> = {};
  for (const t of chosen) {
    const reel = reelSchema.parse(t);
    const comp = await selectComposition({ serveUrl, id: reel.slug, inputProps: reel });
    for (let f = 0; f < totalFrames(reel); f += FPS) {
      const out = join(dir, mode, `${reel.slug}-${f}.png`);
      await renderStill({ composition: comp, serveUrl, output: out, frame: f, inputProps: reel, imageFormat: "png", scale: 0.25 });
      hashes[`${reel.slug}@${f}`] = createHash("sha1").update(readFileSync(out)).digest("hex");
    }
  }
  const inScope = (k: string) => !only.length || only.includes(k.split("@")[0]);
  if (mode === "save") {
    const prev: Record<string, string> = existsSync(base) ? JSON.parse(readFileSync(base, "utf8")) : {};
    const kept = Object.fromEntries(Object.entries(prev).filter(([k]) => !inScope(k)));
    writeFileSync(base, JSON.stringify({ ...kept, ...hashes }, null, 1));
    console.log(`baseline saved: ${Object.keys(hashes).length} frames${only.length ? ` (${only.join(", ")})` : ""}`);
    return;
  }
  if (!existsSync(base)) throw new Error("no baseline: run save first");
  const old: Record<string, string> = Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(base, "utf8")) as Record<string, string>).filter(([k]) => inScope(k)),
  );
  const changed = Object.keys(old).filter((k) => hashes[k] !== old[k]);
  const missing = Object.keys(old).filter((k) => !(k in hashes));
  for (const k of changed) console.log(`CHANGED ${k}`);
  for (const k of missing) console.log(`MISSING ${k}`);
  console.log(`${Object.keys(old).length} frames compared, ${changed.length} changed, ${missing.length} missing`);
  process.exit(changed.length || missing.length ? 1 : 0);
})();
