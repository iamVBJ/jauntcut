#!/usr/bin/env bash
# Removes every identifying tag from a rendered mp4, in place, without re-encoding:
# container tags (encoder "Lavf…", comment "Made with Remotion…"), per-stream encoder
# tags, and the H.264 SEI where x264 writes its version and settings. Frames and audio
# are copied untouched. Usage: bash scripts/strip-meta.sh <file.mp4>
set -euo pipefail
f=${1:?usage: strip-meta.sh <file.mp4>}
tmp="${f%.mp4}.strip.mp4"
ffmpeg -v error -y -i "$f" -map 0 -c copy \
  -map_metadata -1 -map_metadata:s:v -1 -map_metadata:s:a -1 \
  -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -bsf:v filter_units=remove_types=6 -movflags +faststart "$tmp"
mv "$tmp" "$f"
