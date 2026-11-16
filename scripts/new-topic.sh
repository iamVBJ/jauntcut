#!/usr/bin/env bash
# Creates topics/<slug>/ from the template. Usage: npm run new <slug>
set -euo pipefail
cd "$(dirname "$0")/.."
slug=${1:?usage: npm run new <slug>   (lowercase, dashes)}
[[ $slug =~ ^[a-z0-9-]+$ ]] || { echo "slug must be lowercase letters, digits and dashes"; exit 1; }
[ -e "topics/$slug" ] && { echo "topics/$slug already exists"; exit 1; }
mkdir -p "topics/$slug/raw" "topics/$slug/music"
sed "s/__SLUG__/$slug/" topics/_template/reel.ts > "topics/$slug/reel.ts"
npx tsx scripts/topics.ts
echo "Now drop photos/videos in topics/$slug/raw and one track in topics/$slug/music, then: npm run media $slug"
