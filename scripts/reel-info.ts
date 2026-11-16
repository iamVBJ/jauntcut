// Small queries about a topic's reel for the shell scripts.
//   music-source <slug>  path of the library song's guide (empty if the reel uses topics/<slug>/music/)
//   music-meta <slug>    merge the song's title/artist/guide kind into topics/<slug>/music.json
//   mode <slug>          "embed" or "instagram"
//   sync-card <slug>     write out/instagram/<slug>-audio.txt (instagram mode)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reelSchema } from "../src/schema";
import { topics } from "../src/topics.generated";
import { FPS, bpmOf, clipStarts, totalFrames } from "../src/lib";

const [cmd, slug] = process.argv.slice(2);
const t = topics.find((x) => x.slug === slug);
const raw = t as unknown as { music?: { song?: string; mode?: string } } | undefined;
const song = raw?.music?.song;
const songJson = song ? join("music", song, "song.json") : null;

if (cmd === "music-source") {
  if (!song) process.exit(0);
  const guide = join("music", song, "guide.wav");
  if (!existsSync(guide)) {
    console.error(`song ${song} has no guide yet: npm run song -- guide ${song} <recording>`);
    process.exit(1);
  }
  console.log(guide);
} else if (cmd === "music-meta") {
  if (!song || !songJson) process.exit(0);
  const s = JSON.parse(readFileSync(songJson, "utf8"));
  const p = join("topics", slug, "music.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  writeFileSync(p, JSON.stringify({ ...m, source: `${s.title} - ${s.artist}`, title: s.title, artist: s.artist, guideKind: s.guide?.kind, ...(s.guide?.kind === "file" ? { dropAt: Math.round((s.guide.drop - s.guide.start) * 1000) / 1000, cue: s.guide.cue } : {}) }, null, 2) + "\n");
} else if (cmd === "mode") {
  console.log(raw?.music?.mode ?? "embed");
} else if (cmd === "sync-card") {
  if (!t) throw new Error(`no topic ${slug}`);
  const reel = reelSchema.parse(t);
  const tr = reel.track;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  const cuts = clipStarts(reel).slice(1).map((c) => mmss(c.from / FPS));
  const secs = totalFrames(reel) / FPS;
  const cue = (tr as { cue?: string }).cue ?? "the DROP (where the full beat kicks in)";
  const lines = [
    `${slug}: add the audio in Instagram`,
    ``,
    `Song:   ${tr.title ?? tr.source} - ${tr.artist ?? ""}`,
    // A fine grid (bpm over 400) means the cuts were placed on measured musical moments of a
    // song without a steady beat, not on a tempo.
    bpmOf(reel) > 400 ? `Cuts:   on the song's own musical moments (it has no steady beat). Video ${secs.toFixed(2)} s.`
      : `Tempo:  ${bpmOf(reel)} BPM, cuts on the beat. Video ${secs.toFixed(2)} s.`,
    ``,
    `1. Upload out/instagram/${slug}.mp4. It has NO sound on purpose.`,
    tr.guideKind === "recording"
      ? `2. Add the sound from the same trending reel you screen-recorded: tap its sound -> Use audio.\n   Keep Instagram's start point: it is the snippet start the cuts were made to.`
      : tr.guideKind === "file" && tr.dropAt !== undefined
        ? (tr.dropAt > 0.25 // within a quarter second of the start counts as the first frame
          ? `2. Add the song, then drag its start so ${cue} lands at ${mmss(tr.dropAt)}\n   in the video: start the snippet ${Math.round(tr.dropAt / (60 / bpmOf(reel)) / 4)} bars before it. Instagram's version may be a\n   different edit from your file, so line it up by the music, not by a timestamp.`
          : `2. Add the song, then drag its start to ${cue}: it lands on the first frame.\n   Instagram's version may be a different edit from your file, so line it up by the music.`)
        : `2. Add the song, then drag its start until the first beat lands on the first frame\n   (the guide was Apple's 30 s preview, so Instagram's default start may differ).`,
    bpmOf(reel) > 400 ? `3. Check by watching: the cuts should land on these moments of the music` : `3. Check by watching: the cuts should hit the beat at`,
    `   ${cuts.join("  ")}`,
    `   out/${slug}.mp4 (the master) has the guide audio, to compare.`,
  ];
  if (tr.duration && secs > tr.duration + 0.05)
    lines.push(``, `WARNING: the video is longer than the ${tr.duration}s snippet; Instagram loops the sound and later cuts drift.`);
  mkdirSync("out/instagram", { recursive: true });
  writeFileSync(join("out/instagram", `${slug}-audio.txt`), lines.join("\n") + "\n");
  console.log(`sync card out/instagram/${slug}-audio.txt`);
} else {
  console.error("usage: reel-info music-source|music-meta|mode|sync-card <slug>");
  process.exit(1);
}
