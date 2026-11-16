#!/usr/bin/env bash
# Renames a topic everywhere: topics/, public/, places.json, the slug in reel.ts.
# Usage: npm run rename-topic <old> <new>
set -euo pipefail
cd "$(dirname "$0")/.."
old=${1:?usage: npm run rename-topic <old> <new>}; new=${2:?usage: npm run rename-topic <old> <new>}
[[ $new =~ ^[a-z0-9-]+$ ]] || { echo "new name must be lowercase letters, digits and dashes"; exit 1; }
[ -d "topics/$old" ] || { echo "no topic $old"; exit 1; }
[ -e "topics/$new" ] && { echo "topics/$new already exists"; exit 1; }
mv "topics/$old" "topics/$new"
[ -d "public/$old" ] && mv "public/$old" "public/$new"
[ -f "topics/$new/reel.ts" ] && sed -i '' "s/slug: \"$old\"/slug: \"$new\"/" "topics/$new/reel.ts"
if [ -f places.json ]; then
  node -e '
    const fs = require("fs"); const [o, n] = process.argv.slice(1);
    const p = JSON.parse(fs.readFileSync("places.json", "utf8"));
    p.forEach((x) => { if (x.slug === o) x.slug = n; });
    fs.writeFileSync("places.json", JSON.stringify(p, null, 2) + "\n");' "$old" "$new"
fi
npx tsx scripts/topics.ts
echo "renamed $old -> $new"
