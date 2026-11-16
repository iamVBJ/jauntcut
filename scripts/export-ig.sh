#!/usr/bin/env bash
# Makes the Instagram upload copy of a rendered reel from its master.
#   out/<slug>.mp4            master: crf 14, kept for archive / other platforms
#   out/instagram/<slug>.mp4  upload: H.264 High, 1080x1920, 60 fps, ~10-16 Mbps
# Instagram re-encodes every upload; a lighter, clean source avoids it
# compressing an oversized file harder. Usage: bash scripts/export-ig.sh <slug>
set -euo pipefail
cd "$(dirname "$0")/.."
s=${1:?usage: export-ig.sh <slug>}
mkdir -p out/instagram
mode=$(npx tsx scripts/reel-info.ts mode "$s")
if [ "$mode" = "instagram" ]; then
  # The music is only a guide: the upload copy has no audio track at all; the sound
  # is added in Instagram (see the sync card).
  ffmpeg -v error -y -i "out/$s.mp4" -map 0:v:0 -an \
    -c:v libx264 -preset slow -profile:v high -level 4.2 -crf 18 -maxrate 16M -bufsize 32M \
    -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -map_metadata -1 -fflags +bitexact -flags:v +bitexact \
    -movflags +faststart "out/instagram/$s.mp4"
  bash scripts/strip-meta.sh "out/instagram/$s.mp4"
  npx tsx scripts/reel-info.ts sync-card "$s"
  printf '%-22s instagram copy (no audio) %5.1f MB\n' "$s" "$(echo "$(stat -f%z out/instagram/$s.mp4)/1000000" | bc -l)"
  exit 0
fi
# Two-pass loudness normalisation to Instagram's ~-14 LUFS, peaks at -1.5 dBTP,
# so every reel plays at the same level and Instagram doesn't squash loud ones.
m=$(ffmpeg -hide_banner -i "out/$s.mp4" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$m" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
norm="loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true"
ffmpeg -v error -y -i "out/$s.mp4" \
  -c:v libx264 -preset slow -profile:v high -level 4.2 -crf 18 -maxrate 16M -bufsize 32M \
  -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -af "$norm,alimiter=limit=0.79:level=false" -c:a aac -b:a 256k -ar 48000 \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -movflags +faststart "out/instagram/$s.mp4"
# No tags of any kind in what gets uploaded (encoder names, "Made with Remotion").
bash scripts/strip-meta.sh "out/instagram/$s.mp4"
printf '%-22s master %5.1f MB %5.1f Mbps | instagram %5.1f MB %5.1f Mbps\n' "$s" \
  "$(echo "$(stat -f%z out/$s.mp4)/1000000" | bc -l)" \
  "$(ffprobe -v error -show_entries format=bit_rate -of csv=p=0 out/$s.mp4 | awk '{print $1/1e6}')" \
  "$(echo "$(stat -f%z out/instagram/$s.mp4)/1000000" | bc -l)" \
  "$(ffprobe -v error -show_entries format=bit_rate -of csv=p=0 out/instagram/$s.mp4 | awk '{print $1/1e6}')"
