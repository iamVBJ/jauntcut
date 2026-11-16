// One shared Remotion bundle at .cache/bundle, rebuilt in place each time, with
// public/ symlinked rather than copied. (bundle() with defaults made a new temp
// folder holding a full copy of public/ on every call: 90 of them filled the disk.)
// Run directly to (re)build it for the CLI render: npx tsx scripts/bundle.ts
import { existsSync, lstatSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";

export const BUNDLE_DIR = resolve(".cache/bundle");
export const makeBundle = () => {
  // Clear the previous build. Its public/ is a SYMLINK to the real public/: unlink
  // it explicitly first (never follow it), then remove the rest of the old build.
  const link = join(BUNDLE_DIR, "public");
  if (existsSync(link) || lstatSafe(link)) {
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`${link} is not a symlink; refusing to delete`);
    unlinkSync(link);
  }
  rmSync(BUNDLE_DIR, { recursive: true, force: true });
  return bundle({ entryPoint: resolve("src/index.ts"), outDir: BUNDLE_DIR, symlinkPublicDir: true });
};
const lstatSafe = (p: string) => {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
};

if (process.argv[1]?.endsWith("bundle.ts")) makeBundle().then((u) => console.log(u));
