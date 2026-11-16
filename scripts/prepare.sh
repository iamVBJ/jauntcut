#!/usr/bin/env bash
# Prepares a topic for rendering. Originals in topics/<slug>/raw are never changed.
#   photos (HEIC/JPG/PNG) -> public/<slug>/<name>.jpg   sRGB, quality 95
#   videos (MOV/MP4)      -> public/<slug>/<name>.mp4   H.264 SDR bt709, shrunk only as far as still
#                            covering 1440x2560 (landscape keeps its height), own audio kept (AAC)
#   HDR video (HLG/PQ)    -> tone-mapped to SDR (zscale if available, else macOS avconvert)
#   topics/<slug>/media.json: size, fps, duration, audio, HDR of every prepared file
#   topics/<slug>/music/* -> public/<slug>/music.wav    then beat analysis -> topics/<slug>/music.json
# Media smaller than 1080x1920 is skipped and listed (never upscale), unless its name is in
# topics/<slug>/lowres.txt (one per line: footage chosen deliberately although it will be
# enlarged); those are prepared at their own size and listed as LOWRES.
# Usage: npm run media <slug>   |   npm run media all
set -euo pipefail
cd "$(dirname "$0")/.."
SRGB="/System/Library/ColorSync/Profiles/sRGB Profile.icc"

# topics/<slug>/media.json: what the render needs to know about each prepared file.
write_manifest() {
  python3 - "$1" <<'PY'
import json, os, subprocess, sys
slug = sys.argv[1]; d = f"public/{slug}"; out = {}
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f); name, ext = os.path.splitext(f)
    if ext not in (".mp4", ".jpg") or not os.path.isfile(p): continue
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", p],
        capture_output=True, text=True).stdout)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    n, dd = (v.get("r_frame_rate") or "0/1").split("/")
    out[name] = {"w": v["width"], "h": v["height"], "fps": round(int(n) / max(1, int(dd)), 3) if ext == ".mp4" else 0,
                 "duration": round(float(j["format"].get("duration", 0)), 3) if ext == ".mp4" else 0,
                 "audio": any(s["codec_type"] == "audio" for s in j["streams"]),
                 "hdr": os.path.exists(os.path.join(d, f".{name}.hdr"))}
json.dump(out, open(f"topics/{slug}/media.json", "w"), indent=1)
PY
}

prepare() {
  local slug=$1 src="topics/$1/raw" out="public/$1" skipped=0
  [ -d "$src" ] || { echo "no such topic: $slug"; return 1; }
  mkdir -p "$out"
  echo "== $slug"
  shopt -s nullglob nocaseglob
  for f in "$src"/*.heic "$src"/*.jpg "$src"/*.jpeg "$src"/*.png; do
    b=$(basename "${f%.*}")
    [ -f "$out/$b.jpg" ] && continue
    w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
    h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
    if [ $(( w < h ? w : h )) -lt 1080 ] || [ $(( w < h ? h : w )) -lt 1920 ]; then
      echo "  SKIP $b: ${w}x${h} is smaller than 1080x1920"; skipped=$((skipped+1)); continue
    fi
    sips -s format jpeg -s formatOptions 95 -m "$SRGB" "$f" --out "$out/$b.jpg" >/dev/null
    echo "  photo $b ${w}x${h}"
  done
  for f in "$src"/*.mov "$src"/*.mp4 "$src"/*.m4v; do
    b=$(basename "${f%.*}")
    [ -f "$out/$b.mp4" ] && continue
    probe() { ffprobe -v error -select_streams v:0 -show_entries "$1" -of default=nw=1:nk=1 "$f" | head -1; }
    w=$(probe stream=width); h=$(probe stream=height); rot=$(probe stream_side_data=rotation)
    trc=$(probe stream=color_transfer)
    if [ "${rot:-0}" = "90" ] || [ "${rot:-0}" = "-90" ]; then t=$w; w=$h; h=$t; fi
    if [ "$w" -lt 1080 ] || [ "$h" -lt 1920 ]; then
      if [ -f "topics/$slug/lowres.txt" ] && grep -qxF "$(basename "$f")" "topics/$slug/lowres.txt"; then
        echo "  LOWRES $b: ${w}x${h} is smaller than 1080x1920; prepared anyway (lowres.txt), it will be enlarged"
      else
        echo "  SKIP $b: ${w}x${h} is smaller than 1080x1920"; skipped=$((skipped+1)); continue
      fi
    fi
    # HDR (HLG/PQ, e.g. iPhone HDR or HDR exports from edit apps) -> SDR bt709.
    src_file=$f; hdr=0
    if [ "$trc" = "arib-std-b67" ] || [ "$trc" = "smpte2084" ]; then
      hdr=1
      if ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' zscale '; then
        tone="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,"
      elif command -v avconvert >/dev/null; then
        # Apple's own HDR->SDR conversion (AVFoundation), never upscales.
        mkdir -p .cache/hdr
        src_file=".cache/hdr/$b.mov"
        avconvert -s "$f" -p Preset3840x2160 -o "$src_file" --replace >/dev/null
        tone="colorspace=all=bt709:iall=bt709:fast=1,"
      else
        echo "  SKIP $b: HDR ($trc) and no zscale or avconvert to tone-map it"; skipped=$((skipped+1)); continue
      fi
    else
      tone="colorspace=all=bt709:iall=bt709:fast=1,"
    fi
    has_audio=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$src_file" | head -1)
    if [ -n "$has_audio" ]; then audio=(-map 0:v:0 -map 0:a:0 -c:a aac -b:a 192k -ac 2); else audio=(-an); fi
    ffmpeg -v error -y -i "$src_file" "${audio[@]}" \
      -vf "scale='trunc(iw*min(1,max(1440/iw,2560/ih))/2)*2':-2,${tone}format=yuv420p" \
      -c:v libx264 -preset slow -crf 16 -g 30 \
      -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
      -movflags +faststart "$out/$b.mp4"
    [ "$hdr" = 1 ] && touch "$out/.$b.hdr"
    [ "$src_file" != "$f" ] && rm -f "$src_file"
    echo "  video $b ${w}x${h} ${trc}${has_audio:+ +audio}"
  done
  write_manifest "$slug"
  local track="" count=0
  # A library song (music: { song } in reel.ts) wins over files in topics/<slug>/music/.
  local song_src=""
  [ -f "topics/$slug/reel.ts" ] && song_src=$(npx tsx scripts/reel-info.ts music-source "$slug")
  [ -n "$song_src" ] && { track=$song_src; count=1; }
  [ -z "$song_src" ] && for m in "topics/$slug/music"/*.mp3 "topics/$slug/music"/*.wav "topics/$slug/music"/*.m4a "topics/$slug/music"/*.aac "topics/$slug/music"/*.flac; do
    count=$((count+1)); [ -z "$track" ] && track=$m
  done
  if [ "$count" -gt 1 ]; then echo "  $count tracks in topics/$slug/music, using $(basename "$track")"; fi
  if [ -n "$track" ]; then
    ffmpeg -v error -y -i "$track" -vn -ac 2 -ar 48000 "$out/music.wav"
    python3 scripts/beats.py "$out/music.wav" "topics/$slug/music.json" "$(basename "$track")"
    [ -n "$song_src" ] && npx tsx scripts/reel-info.ts music-meta "$slug"
  else
    echo "  no music in topics/$slug/music (cuts use the bpm in music.json)"
  fi
  echo "  skipped $skipped"
}

if [ "${1:-}" = "all" ]; then
  for d in topics/*/; do s=$(basename "$d"); [[ $s == _* ]] || prepare "$s"; done
else
  prepare "${1:?usage: npm run media <slug>|all}"
fi
npx tsx scripts/topics.ts
