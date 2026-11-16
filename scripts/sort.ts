// Sorts new media from inbox/ into topics/<slug>/raw/ by where and when it was shot.
//
//   npm run sort               move files, print what went where
//   npm run sort -- --dry      only print the plan
//   npm run sort -- --undo     move the last batch back into inbox/
//
// How a file is placed:
//  0. Inside inbox/<topic>/                             -> that topic, GPS ignored
//  1. GPS within a known place's radius (places.json)  -> that topic
//  2. GPS but no known place                            -> new topic "new-<date>-<n>",
//     grouped with other new files within 150 m, and added to places.json
//  3. No GPS, but shot within 20 min of a placed file   -> same topic as that file
//     (original camera files only; shared/exported files go to _unsorted)
//  4. Nothing to go on                                  -> topics/_unsorted/raw
// Nothing is overwritten: exact duplicates go to inbox/_duplicates, name clashes
// get a -2, -3 suffix. Every move is logged in logs/ so --undo can reverse it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const INBOX = "inbox";
const PLACES = "places.json";
const NEW_RADIUS_M = 150;
const TIME_WINDOW_MIN = 20;
const MEDIA = /\.(heic|jpe?g|png|mov|mp4|m4v)$/i;
const VIDEO = /\.(mov|mp4|m4v)$/i;

type Place = { slug: string; lat: number; lon: number; radiusM: number };
// camera: make/model from the file. Missing on shared/exported files, whose
// timestamps can come from another phone or the export, so they aren't trusted.
type Meta = { file: string; lat?: number; lon?: number; time?: Date; camera?: string };
type Move = { from: string; to: string };
type Log = { moves: Move[]; placesBefore: Place[] | null; createdDirs: string[] };

const args = process.argv.slice(2);
const dry = args.includes("--dry");

const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
};

const run = (cmd: string, a: string[]) => {
  try {
    return execFileSync(cmd, a, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return "";
  }
};

export const readMeta = (file: string): Meta => {
  if (VIDEO.test(file)) {
    const out = run("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "default=nw=1", file]);
    const loc = out.match(/ISO6709=([+-][\d.]+)([+-][\d.]+)/);
    // Apple's creationdate has the real local capture time; creation_time can be the export time.
    const t = out.match(/com\.apple\.quicktime\.creationdate=(\S+)/) ?? out.match(/creation_time=(\S+)/);
    const make = out.match(/com\.apple\.quicktime\.make=(.+)/)?.[1] ?? out.match(/\bmake=(.+)/)?.[1];
    const model = out.match(/com\.apple\.quicktime\.model=(.+)/)?.[1] ?? out.match(/\bmodel=(.+)/)?.[1];
    return {
      file,
      camera: [make, model].filter(Boolean).join(" ") || undefined,
      lat: loc ? Number(loc[1]) : undefined,
      lon: loc ? Number(loc[2]) : undefined,
      time: t ? new Date(t[1].replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : undefined,
    };
  }
  return readPhotos([file])[0];
};

// Photos: EXIF via the ImageIO helper (scripts/photometa.swift), compiled once into .cache/.
const HELPER = ".cache/photometa";
const ensureHelper = () => {
  const src = "scripts/photometa.swift";
  if (!existsSync(HELPER) || statSync(HELPER).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(".cache", { recursive: true });
    execFileSync("swiftc", ["-O", src, "-o", HELPER], { stdio: "inherit" });
  }
};
export const readPhotos = (files: string[]): Meta[] => {
  if (files.length === 0) return [];
  ensureHelper();
  const out = execFileSync(HELPER, files).toString().trim().split("\n");
  return out.map((line) => {
    const j = JSON.parse(line);
    return { file: j.file, lat: j.lat, lon: j.lon, time: j.time ? new Date(j.time) : undefined, camera: j.camera };
  });
};
export const readAll = (files: string[]): Meta[] => {
  const photos = new Map(readPhotos(files.filter((f) => !VIDEO.test(f))).map((m) => [m.file, m]));
  return files.map((f) => (VIDEO.test(f) ? readMeta(f) : (photos.get(f) as Meta)));
};

const hash = (f: string) => createHash("sha1").update(readFileSync(f)).digest("hex");

// Destination that never overwrites. Returns null if the same content is already
// in dir under any name (only same-size files are hashed, so this stays fast).
const destination = (src: string, dir: string): string | null => {
  if (existsSync(dir)) {
    const size = statSync(src).size;
    const same = readdirSync(dir).map((f) => join(dir, f)).filter((f) => statSync(f).isFile() && statSync(f).size === size);
    if (same.length) {
      const h = hash(src);
      if (same.some((f) => hash(f) === h)) return null;
    }
  }
  const ext = extname(src);
  const base = basename(src, ext);
  for (let n = 1; ; n++) {
    const to = join(dir, n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`);
    if (!existsSync(to)) return to;
  }
};

const undo = () => {
  if (!existsSync("logs")) return console.log("nothing to undo");
  const logs = readdirSync("logs").filter((f) => f.startsWith("sort-")).sort();
  const last = logs.at(-1);
  if (!last) return console.log("nothing to undo");
  const log: Log = JSON.parse(readFileSync(join("logs", last), "utf8"));
  const moves = log.moves;
  let failed = 0;
  for (const m of [...moves].reverse()) {
    if (!existsSync(m.to) || existsSync(m.from)) {
      failed++;
      console.log(`FAIL cannot move back ${m.to} -> ${m.from}`);
      continue;
    }
    if (!dry) {
      mkdirSync(dirname(m.from), { recursive: true });
      renameSync(m.to, m.from);
    }
    console.log(`back ${m.to} -> ${m.from}`);
  }
  // Restore places.json and remove topic folders the sort created, if now empty.
  if (!dry) {
    if (log.placesBefore === null) {
      if (existsSync(PLACES)) unlinkSync(PLACES);
    } else {
      writeFileSync(PLACES, JSON.stringify(log.placesBefore, null, 2) + "\n");
    }
    for (const d of [...log.createdDirs].reverse()) {
      try {
        rmdirSync(d);
      } catch {
        console.log(`kept ${d} (not empty)`);
      }
    }
  }
  if (!dry) renameSync(join("logs", last), join("logs", `undone-${last}`));
  console.log(`${moves.length - failed} moved back, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

const main = () => {
  if (args.includes("--undo")) return undo();
  mkdirSync(INBOX, { recursive: true });
  // Subfolders force a topic: inbox/night-market/IMG_1.mov -> topics/night-market.
  const entries = readdirSync(INBOX, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") && !e.name.startsWith("_"));
  const forced = new Map<string, string>();
  const badFolders: string[] = [];
  for (const d of entries.filter((e) => e.isDirectory())) {
    if (!/^[a-z0-9-]+$/.test(d.name)) {
      badFolders.push(d.name);
      continue;
    }
    for (const f of readdirSync(join(INBOX, d.name))) if (MEDIA.test(f)) forced.set(join(INBOX, d.name, f), d.name);
  }
  const loose = entries.filter((e) => e.isFile());
  const files = [...loose.filter((e) => MEDIA.test(e.name)).map((e) => join(INBOX, e.name)), ...forced.keys()];
  const ignored = loose.filter((e) => !MEDIA.test(e.name)).map((e) => e.name);
  if (files.length === 0) {
    console.log("inbox is empty");
    return;
  }
  const places: Place[] = existsSync(PLACES) ? JSON.parse(readFileSync(PLACES, "utf8")) : [];
  const metas = readAll(files);
  const slugOf = new Map<string, string>();
  const reason = new Map<string, string>();
  const created: Place[] = [];

  // 0: folder override.
  for (const m of metas) {
    const slug = forced.get(m.file);
    if (slug) {
      slugOf.set(m.file, slug);
      reason.set(m.file, `folder inbox/${slug}/`);
    }
  }

  // 1 + 2: GPS.
  for (const m of metas) {
    if (slugOf.has(m.file) || m.lat === undefined || m.lon === undefined) continue;
    const p = { lat: m.lat, lon: m.lon };
    const known = places
      .map((pl) => ({ pl, d: distM(p, pl) }))
      .filter(({ pl, d }) => d <= pl.radiusM)
      .sort((a, b) => a.d - b.d)[0];
    if (known) {
      slugOf.set(m.file, known.pl.slug);
      reason.set(m.file, `${Math.round(known.d)} m from ${known.pl.slug}`);
      continue;
    }
    let group = created.find((c) => distM(p, c) <= NEW_RADIUS_M);
    if (!group) {
      const day = (m.time ?? new Date()).toISOString().slice(0, 10);
      let n = 1;
      const taken = (s: string) => existsSync(join("topics", s)) || [...places, ...created].some((x) => x.slug === s);
      while (taken(`new-${day}-${n}`)) n++;
      group = { slug: `new-${day}-${n}`, lat: p.lat, lon: p.lon, radiusM: NEW_RADIUS_M };
      created.push(group);
    }
    slugOf.set(m.file, group.slug);
    reason.set(m.file, `new place ${p.lat.toFixed(5)},${p.lon.toFixed(5)}`);
  }

  // 3 + 4: no GPS. Borrow the topic of the closest-in-time placed file, from this
  // batch or already in the library.
  const library: { time: Date; slug: string; name: string }[] = [];
  const needTime = metas.some((m) => !slugOf.has(m.file) && m.time);
  if (needTime) {
    const slugs = readdirSync("topics").filter((d) => !d.startsWith("_") && existsSync(join("topics", d, "raw")));
    const libFiles = slugs.flatMap((d) =>
      readdirSync(join("topics", d, "raw")).filter((f) => MEDIA.test(f)).map((f) => join("topics", d, "raw", f)),
    );
    const slugByFile = new Map(libFiles.map((f) => [f, f.split("/")[1]]));
    for (const m of readAll(libFiles)) {
      if (m.time) library.push({ time: m.time, slug: slugByFile.get(m.file) as string, name: m.file });
    }
  }
  for (const m of metas) {
    if (slugOf.has(m.file) && m.time) library.push({ time: m.time, slug: slugOf.get(m.file) as string, name: m.file });
  }
  for (const m of metas) {
    if (slugOf.has(m.file)) continue;
    if (!m.camera) {
      slugOf.set(m.file, "_unsorted");
      reason.set(m.file, "no GPS and not an original camera file (shared/exported): put it in inbox/<topic>/");
      continue;
    }
    const near = m.time
      ? library
          .map((o) => ({ o, dt: Math.abs(o.time.getTime() - (m.time as Date).getTime()) / 60000 }))
          .filter(({ dt }) => dt <= TIME_WINDOW_MIN)
          .sort((a, b) => a.dt - b.dt)[0]
      : undefined;
    if (near) {
      slugOf.set(m.file, near.o.slug);
      reason.set(m.file, `no GPS, shot ${Math.round(near.dt)} min from ${basename(near.o.name)}`);
    } else {
      slugOf.set(m.file, "_unsorted");
      reason.set(m.file, m.time ? "no GPS, nothing shot nearby in time" : "no GPS and no capture time");
    }
  }

  // Move.
  const moves: Move[] = [];
  const createdDirs: string[] = [];
  const mk = (d: string) => {
    if (dry || existsSync(d)) return;
    const parts = d.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join("/");
      if (!existsSync(sub)) {
        mkdirSync(sub);
        createdDirs.push(sub);
      }
    }
  };
  const counts = new Map<string, number>();
  let dupes = 0;
  const rows: string[] = [];
  for (const m of metas) {
    const slug = slugOf.get(m.file) as string;
    const dir = join("topics", slug, "raw");
    mk(dir);
    const to = existsSync(dir) ? destination(m.file, dir) : join(dir, basename(m.file));
    if (to === null) {
      dupes++;
      const d = join(INBOX, "_duplicates");
      const dupTo = destination(m.file, d) ?? join(d, `${Date.now()}-${basename(m.file)}`);
      mk(d);
      if (!dry) renameSync(m.file, dupTo);
      moves.push({ from: m.file, to: dupTo });
      rows.push(`${basename(m.file).padEnd(18)} duplicate of a file already in ${dir} -> inbox/_duplicates`);
      continue;
    }
    if (!dry) renameSync(m.file, to);
    moves.push({ from: m.file, to });
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
    const when = m.time ? m.time.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "no time         ";
    const renamed = basename(to) !== basename(m.file) ? ` (as ${basename(to)}, name taken)` : "";
    rows.push(`${basename(m.file).padEnd(20)} ${when}  -> ${slug.padEnd(22)} ${reason.get(m.file)}${renamed}`);
  }

  if (!dry) {
    const keep = created.filter((c) => counts.has(c.slug));
    const placesBefore = existsSync(PLACES) ? places : null;
    if (keep.length) writeFileSync(PLACES, JSON.stringify([...places, ...keep], null, 2) + "\n");
    for (const c of keep) mk(join("topics", c.slug, "music"));
    mkdirSync("logs", { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 18);
    const log: Log = { moves, placesBefore, createdDirs };
    writeFileSync(join("logs", `sort-${stamp}.json`), JSON.stringify(log, null, 2) + "\n");
  }

  if (!dry) {
    for (const d of new Set(forced.values())) {
      try {
        rmdirSync(join(INBOX, d));
      } catch {
        // not empty (non-media files left inside): keep it
      }
    }
  }
  console.log(`${dry ? "PLAN (dry run, nothing moved)" : "SORTED"}\n`);
  rows.sort().forEach((r) => console.log(r));
  console.log("\nper topic:");
  for (const [s, n] of [...counts].sort()) console.log(`  ${s.padEnd(26)} ${n}`);
  const used = created.filter((c) => counts.has(c.slug));
  if (used.length) {
    console.log("\nnew places (rename with: npm run rename-topic <old> <new>):");
    for (const c of used) console.log(`  ${c.slug}  https://maps.google.com/?q=${c.lat},${c.lon}`);
  }
  if (badFolders.length) console.log(`\nskipped folders (use lowercase-and-dashes names): ${badFolders.join(", ")}`);
  if (ignored.length) console.log(`\nnot media, left in inbox: ${ignored.join(", ")}`);
  console.log(`\n${moves.length - dupes} ${dry ? "to move" : "moved"}, ${dupes} duplicates, ${counts.get("_unsorted") ?? 0} unsorted, ${ignored.length} ignored`);
};

if (process.argv[1]?.endsWith("sort.ts")) main();
