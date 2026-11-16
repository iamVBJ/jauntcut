// Song library for cutting to trending / Instagram audio (music/<song>/).
//
//   npm run song -- search "funkytown lipps"     find a song (Apple iTunes Search API, metadata only)
//   npm run song -- add <itunesId> [song-slug]   save its details to music/<slug>/song.json
//   npm run song -- guide <slug> <recording> [--start S]
//        beat guide from YOUR screen recording of the trending reel's sound: start
//        recording, then press play on the sound in Instagram's editor. Gives the exact
//        snippet Instagram uses. Put recordings in inbox/_audio/.
//   npm run song -- preview <slug>   download Apple's official 30 s preview as the guide
//        (a download of the store preview). Instagram's snippet may start elsewhere,
//        so the sync card says to line the beat up by ear.
//   npm run song -- file <slug> <audio> [--drop S] [--start S] [--seconds N]
//        guide from an audio file you have (mp3 etc.); starts 2 bars before the drop.
//   npm run song -- show <slug>
//
// A reel uses a song with  music: { song: "<slug>", mode: "instagram" }  in its reel.ts.
// The guide is never uploaded: in instagram mode the Instagram copy has no audio.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [cmd, ...args] = process.argv.slice(2);
const lib = "music";
const songFile = (slug: string) => join(lib, slug, "song.json");
const load = (slug: string) => {
  if (!existsSync(songFile(slug))) throw new Error(`no song ${slug}: npm run song -- add <itunesId> ${slug}`);
  return JSON.parse(readFileSync(songFile(slug), "utf8"));
};
const save = (slug: string, data: object) => {
  mkdirSync(join(lib, slug), { recursive: true });
  writeFileSync(songFile(slug), JSON.stringify(data, null, 2) + "\n");
};
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const itunes = async (q: Record<string, string>) => {
  const r = await fetch(`https://itunes.apple.com/${q.id ? "lookup" : "search"}?${new URLSearchParams(q)}`);
  if (!r.ok) throw new Error(`iTunes API ${r.status}`);
  return (await r.json()).results as Record<string, unknown>[];
};
// Beat analysis (scripts/beats.py) of a guide file -> bpm, firstBeat, duration.
const analyse = (slug: string, file: string) => {
  const tmp = join(lib, slug, ".analysis.json");
  execFileSync("python3", ["scripts/beats.py", join(lib, slug, file), tmp, file], { stdio: "inherit" });
  return JSON.parse(readFileSync(tmp, "utf8"));
};

const main = async () => {
  if (cmd === "search") {
    const res = await itunes({ term: args.join(" "), entity: "song", limit: "8" });
    for (const r of res)
      console.log(
        `${String(r.trackId).padEnd(12)} ${String(r.trackName).slice(0, 34).padEnd(34)} ${String(r.artistName).slice(0, 24).padEnd(24)} ` +
          `${Math.round(Number(r.trackTimeMillis) / 1000)}s ${r.previewUrl ? "preview" : ""}`,
      );
  } else if (cmd === "add") {
    const [id, given] = args;
    const [r] = await itunes({ id, entity: "song" });
    if (!r) throw new Error(`no iTunes track ${id}`);
    const slug = given ?? slugify(`${r.trackName} ${r.artistName}`);
    save(slug, {
      title: r.trackName, artist: r.artistName, itunesId: r.trackId, duration: Math.round(Number(r.trackTimeMillis) / 1000),
      previewUrl: r.previewUrl ?? null, addedAt: new Date().toISOString().slice(0, 10),
    });
    console.log(`added ${slug}: ${r.trackName} - ${r.artistName}`);
  } else if (cmd === "guide") {
    const [slug, rec, ...rest] = args;
    const song = load(slug);
    const out = join(lib, slug, "guide.wav");
    let res: Record<string, unknown>;
    try {
      res = JSON.parse(execFileSync("python3", ["scripts/guide.py", rec, out, ...rest]).toString());
    } catch (e) {
      const so = (e as { stdout?: Buffer }).stdout?.toString();
      throw new Error(so || String(e));
    }
    const a = analyse(slug, "guide.wav");
    save(slug, { ...song, guide: { file: "guide.wav", kind: "recording", from: rec, ...res, bpm: a.bpm, firstBeat: a.firstBeat, duration: a.duration } });
    console.log(`guide ready: ${a.bpm} BPM, first beat ${a.firstBeat}s, snippet ${a.duration}s (start found by ${res.method})`);
  } else if (cmd === "file") {
    // An audio file you already have (e.g. an mp3 of the song). The guide starts at
    // --start S (default: the detected drop / full-energy bar). Instagram's version
    // may be a different edit, so the sync card cues the start by the music, not a time.
    const [slug, file, ...rest] = args;
    const song = load(slug);
    const at = rest.includes("--start") ? Number(rest[rest.indexOf("--start") + 1]) : null;
    const secs = rest.includes("--seconds") ? Number(rest[rest.indexOf("--seconds") + 1]) : 60;
    const full = join(lib, slug, "full.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-ac", "2", "-ar", "48000", full]);
    const whole = analyse(slug, "full.wav");
    // --drop S: the measured drop downbeat (the full-track estimate works on 2 s
    // windows and can be ~1 s off). Default start: 2 bars before the drop.
    const drop = rest.includes("--drop") ? Number(rest[rest.indexOf("--drop") + 1]) : whole.suggestedStart;
    const start = at ?? Math.max(0, drop - 8 * (60 / whole.bpm));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", start.toFixed(4), "-t", String(secs), "-i", full, join(lib, slug, "guide.wav")]);
    const a = analyse(slug, "guide.wav");
    // --cue "..." names the moment for the sync card (default: the drop).
    const cue = rest.includes("--cue") ? rest[rest.indexOf("--cue") + 1] : "the DROP (where the full beat kicks in)";
    save(slug, { ...song, guide: { file: "guide.wav", kind: "file", from: file, start, drop, cue, bpm: a.bpm, firstBeat: a.firstBeat, duration: a.duration } });
    console.log(`file guide ready: ${a.bpm} BPM, starts ${start.toFixed(2)}s into the file (drop at ${drop}s)`);
  } else if (cmd === "preview") {
    const [slug] = args;
    const song = load(slug);
    if (!song.previewUrl) throw new Error("no preview for this track");
    const raw = join(lib, slug, "preview.m4a");
    execFileSync("curl", ["-sSfL", "-o", raw, song.previewUrl]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-ac", "2", "-ar", "48000", join(lib, slug, "guide.wav")]);
    const a = analyse(slug, "guide.wav");
    save(slug, { ...song, guide: { file: "guide.wav", kind: "preview", bpm: a.bpm, firstBeat: a.firstBeat, duration: a.duration } });
    console.log(`preview guide ready: ${a.bpm} BPM, ${a.duration}s`);
  } else if (cmd === "show") {
    console.log(JSON.stringify(load(args[0]), null, 2));
  } else {
    console.log("usage: npm run song -- search <query> | add <itunesId> [slug] | guide <slug> <recording> [--start S] | file <slug> <audio> [--start S] | preview <slug> | show <slug>");
    process.exit(1);
  }
};
main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
