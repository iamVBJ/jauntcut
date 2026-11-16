#!/usr/bin/env bash
# Moves a reel that has been posted out of the working set, into posted/<slug>/:
#   topic/    topics/<slug> (reel.ts, raw footage, music, layout, backups)
#   public/   public/<slug> (prepared and derived media)
#   review/   review/<slug>
#   out/      the delivered files: <slug>.mp4 (with audio) and instagram/ (upload copy, sync card)
#   archive/  earlier versions from out/archive, qa/ sheets, its regression baseline frames
# The reel then no longer renders, regresses or shows in the studio. Nothing is deleted.
# Usage: npm run post-topic <slug>
set -euo pipefail
cd "$(dirname "$0")/.."
s=${1:?usage: post-topic <slug>}
[ -f "topics/$s/reel.ts" ] || { echo "no topic topics/$s"; exit 1; }
d="posted/$s"
[ -e "$d" ] && { echo "$d already exists"; exit 1; }
mkdir -p "$d/out/instagram" "$d/archive" "$d/qa"
mv "topics/$s" "$d/topic"
[ -d "public/$s" ] && mv "public/$s" "$d/public"
[ -d "review/$s" ] && mv "review/$s" "$d/review"
[ -f "out/$s.mp4" ] && mv "out/$s.mp4" "$d/out/"
for f in out/instagram/"$s".* out/instagram/"$s"-*; do [ -e "$f" ] && mv "$f" "$d/out/instagram/"; done
for f in out/archive/"$s"-* out/archive/"$s".*; do [ -e "$f" ] && mv "$f" "$d/archive/"; done
for f in out/qa/"$s"-* .cache/qa-"$s".json; do [ -e "$f" ] && mv "$f" "$d/qa/"; done
# Its frames leave the regression baseline (kept beside it), so compare stays meaningful.
python3 - "$s" "$d" <<'PY'
import json, os, sys
s, d = sys.argv[1], sys.argv[2]
p = ".cache/regress/baseline.json"
if os.path.exists(p):
    b = json.load(open(p))
    mine = {k: v for k, v in b.items() if k.split("@")[0] == s}
    json.dump({k: v for k, v in b.items() if k not in mine}, open(p, "w"), indent=1)
    json.dump(mine, open(f"{d}/qa/regress-baseline.json", "w"), indent=1)
    print(f"regression baseline: {len(mine)} frames moved out")
PY
npx tsx scripts/topics.ts >/dev/null
echo "posted: $s -> $d ($(du -sh "$d" | cut -f1))"
