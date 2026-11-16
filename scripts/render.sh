#!/usr/bin/env bash
# Renders one topic or all, with the quality gates around it:
#   derive -> layout -> check -> qa --pre -> render master -> instagram copy -> qa --post
# Stops at the first failure. Usage: npm run render <slug>|all
set -euo pipefail
cd "$(dirname "$0")/.."
target=${1:?usage: npm run render <slug>|all}
npx tsx scripts/topics.ts >/dev/null
if [ "$target" = "all" ]; then
  slugs=$(for d in topics/*/; do s=$(basename "$d"); [[ $s == _* ]] || [ ! -f "$d/reel.ts" ] || echo "$s"; done)
else
  slugs=$target
fi
mkdir -p out
# Runs a command with a time limit. The command gets its own process group and the whole
# group is killed on timeout: killing only the launcher left Chrome and the encoder running
# (an orphaned render kept going for an hour and could have overwritten the next output).
timed() {
  perl -e '
    my $limit = shift; my $pid = fork // die "fork: $!";
    if (!$pid) { setpgrp(0, 0); exec @ARGV or die "exec: $!" }
    local $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 3; kill "KILL", -$pid; warn "timed out after ${limit}s\n"; exit 124 };
    alarm $limit; waitpid($pid, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$@"
}
npx tsx scripts/bundle.ts >/dev/null   # one shared bundle; renders below reuse it
for s in $slugs; do
  echo "== $s"
  npx tsx scripts/derive.ts "$s"   # reverse / smooth slow-mo / stabilise clips
  npx tsx scripts/layout.ts "$s"
  npx tsx scripts/check.ts "$s"
  python3 scripts/qa.py "$s" --pre
  npx tsx scripts/bundle.ts >/dev/null   # rebuild in place (layout may have changed)
  # Chrome can crash under memory pressure with heavy SVG effects (ripple, bloom) and
  # then hang instead of exiting. Each attempt has a time limit; on a crash or hang it
  # retries with fewer parallel tabs (2 rendered the spa reel when 5 crashed at frame 116).
  rendered=0
  for c in 4 2; do
    if timed 900 npx remotion render .cache/bundle "$s" "out/$s.mp4" --concurrency=$c; then
      rendered=1; break
    fi
    echo "render of $s failed or hung with $c tabs; retrying with fewer"
  done
  [ $rendered = 1 ] || { echo "FAIL render of $s"; exit 1; }
  bash scripts/strip-meta.sh "out/$s.mp4"   # no "Made with Remotion" / encoder tags
  bash scripts/export-ig.sh "$s"
  python3 scripts/qa.py "$s" --post
done
