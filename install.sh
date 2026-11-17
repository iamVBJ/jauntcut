#!/usr/bin/env bash
# Jauntcut installer for macOS.
#
#   curl -fsSL https://jauntcut.com/install.sh | bash
#   curl -fsSL https://jauntcut.com/install.sh | bash -s -- --dir ~/Code/jauntcut
#
# Options:
#   --dir <path>   where to put Jauntcut (default: ~/jauntcut)
#   --check        only report what is installed and what is missing; change nothing
#   --no-depth     skip the depth model download (48 MB; only needed for 3D photo moves)
#   --yes          do not ask before installing missing tools
#
# What it does, in order: checks the Mac and the Xcode command-line tools, installs
# Node, ffmpeg, NumPy and Pillow if they are missing (Homebrew), clones Jauntcut,
# installs its packages, downloads the depth model (checksums verified), and runs a
# self-check. It never uses sudo. Running it again updates an existing install.
#
# Everything is wrapped in main(), so a half-downloaded script does nothing.

set -euo pipefail

REPO="${JAUNTCUT_REPO:-https://github.com/iamVBJ/jauntcut.git}"
REF="${JAUNTCUT_REF:-main}"
# Apple's Core ML build of Depth Anything V2 Small (Apache-2.0), pinned to one revision.
MODEL_REV="cfef6f6f2a70783dedc0bfae40cecbc2052285d3"
MODEL_URL="https://huggingface.co/apple/coreml-depth-anything-v2-small/resolve/$MODEL_REV/DepthAnythingV2SmallF16.mlpackage"
MODEL_FILES=(
  "Manifest.json 2883ae290c48fe916dc5ececac03a7d847fa277165a49ef5652fa1d2b9cb55f7"
  "Data/com.apple.CoreML/model.mlmodel 44ac97a3efcfd52113183fb2862ff59cd0368e9ec2e30a90a54980dd11407042"
  "Data/com.apple.CoreML/weights/weight.bin fa60d9b6a155734f59029ebb882fd54e549bfaee3539c1a9cbd2cbbab64a0fed"
)
NODE_MIN=20

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else B=""; G=""; Y=""; R=""; D=""; N=""; fi
step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
miss() { printf '  %s•%s %s\n' "$Y" "$N" "$1"; }
fail() { printf '\n%sError:%s %s\n' "$R" "$N" "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

ask() { # ask "question" -> 0 for yes
  [ "$YES" = 1 ] && return 0
  [ "$CHECK" = 1 ] && return 1
  local a
  if [ -r /dev/tty ]; then printf '  %s [Y/n] ' "$1" > /dev/tty; read -r a < /dev/tty || a=n
  else return 1; fi
  case "$a" in ""|y|Y|yes|Yes) return 0;; *) return 1;; esac
}

main() {
  DIR="$HOME/jauntcut"; CHECK=0; DEPTH=1; YES=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) DIR="${2:?--dir needs a path}"; shift 2;;
      --check) CHECK=1; shift;;
      --no-depth) DEPTH=0; shift;;
      --yes|-y) YES=1; shift;;
      -h|--help) sed -n '2,19p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0;;
      *) fail "unknown option: $1 (try --help)";;
    esac
  done
  DIR="${DIR/#\~/$HOME}"
  local missing=0

  printf '%sJauntcut installer%s %s(%s)%s\n' "$B" "$N" "$D" "$([ $CHECK = 1 ] && echo "check only, nothing will change" || echo "installing into $DIR")" "$N"

  step "Mac"
  [ "$(uname -s)" = Darwin ] || fail "Jauntcut's analysis tools use Apple Vision and Core ML, so it needs macOS."
  local ver arch; ver=$(sw_vers -productVersion); arch=$(uname -m)
  # Subject cutouts use Vision's foreground instance masks, which arrived in macOS 14.
  [ "${ver%%.*}" -ge 14 ] 2>/dev/null || fail "Jauntcut needs macOS 14 (Sonoma) or newer; this Mac has $ver."
  ok "macOS $ver"
  if [ "$arch" = arm64 ]; then ok "Apple silicon"
  else miss "Intel Mac: it runs, but the vision steps are much slower than on Apple silicon"; fi

  step "Xcode command-line tools (Swift compiler for the vision tools)"
  if xcode-select -p >/dev/null 2>&1 && have swiftc; then ok "$(swiftc --version 2>&1 | head -1 | sed 's/ (.*//')"
  else
    missing=1; miss "not installed"
    if [ $CHECK = 0 ]; then
      xcode-select --install >/dev/null 2>&1 || true
      fail "A macOS window has opened to install the command-line tools. When it finishes, run this installer again."
    fi
  fi

  step "Homebrew, Node, ffmpeg"
  local brew_ok=0; have brew && brew_ok=1
  [ $brew_ok = 1 ] && ok "Homebrew $(brew --version | head -1 | awk '{print $2}')" || miss "Homebrew not found"
  local node_ok=0
  if have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge $NODE_MIN ] 2>/dev/null; then node_ok=1; ok "Node $(node -v)"
  else missing=1; miss "Node $NODE_MIN or newer not found"; fi
  local ff_ok=0
  if have ffmpeg && have ffprobe; then ff_ok=1; ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"
  else missing=1; miss "ffmpeg not found"; fi
  if [ $CHECK = 0 ] && { [ $node_ok = 0 ] || [ $ff_ok = 0 ]; }; then
    if [ $brew_ok = 0 ]; then
      fail "Node and ffmpeg are installed with Homebrew. Install Homebrew first (see https://brew.sh), then run this installer again."
    fi
    local pkgs=(); [ $node_ok = 0 ] && pkgs+=(node); [ $ff_ok = 0 ] && pkgs+=(ffmpeg)
    ask "Install ${pkgs[*]} with Homebrew?" || fail "Jauntcut needs ${pkgs[*]}. Install with: brew install ${pkgs[*]}"
    brew install "${pkgs[@]}"
    ok "installed ${pkgs[*]}"
  fi

  step "Python 3 with NumPy and Pillow (beat analysis and QA)"
  have python3 || fail "python3 not found. It comes with the Xcode command-line tools."
  local py; py=$(command -v python3)
  ok "Python $(python3 -c 'import sys; print(sys.version.split()[0])') ($py)"
  if python3 -c 'import numpy, PIL' >/dev/null 2>&1; then ok "NumPy and Pillow"
  else
    missing=1; miss "NumPy or Pillow missing"
    if [ $CHECK = 0 ]; then
      ask "Install NumPy and Pillow for $py?" || fail "Install them with: python3 -m pip install --user numpy pillow"
      if [ $brew_ok = 1 ] && [[ "$py" == "$(brew --prefix)"/* ]]; then brew install numpy pillow
      else python3 -m pip install --user --quiet numpy pillow; fi
      python3 -c 'import numpy, PIL' >/dev/null 2>&1 || fail "NumPy and Pillow still do not import for $py."
      ok "installed NumPy and Pillow"
    fi
  fi

  step "Jauntcut"
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" remote get-url origin 2>/dev/null | grep -qi jauntcut || fail "$DIR exists and is not a Jauntcut checkout. Choose another folder with --dir."
    ok "found at $DIR ($(git -C "$DIR" rev-parse --short HEAD))"
    if [ $CHECK = 0 ]; then
      if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then miss "local changes to tracked files: leaving the code as it is"
      else git -C "$DIR" pull --ff-only --quiet && ok "updated to $(git -C "$DIR" rev-parse --short HEAD)"; fi
    fi
  elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    fail "$DIR exists and is not empty. Choose another folder with --dir."
  else
    missing=1; miss "not installed at $DIR"
    if [ $CHECK = 0 ]; then
      git clone --quiet --depth 1 --branch "$REF" "$REPO" "$DIR"
      ok "cloned into $DIR"
    fi
  fi

  if [ $CHECK = 1 ]; then
    if [ -d "$DIR/node_modules" ]; then ok "packages installed"; else miss "packages not installed"; missing=1; fi
    if [ -f "$DIR/.cache/models/DepthAnythingV2SmallF16.mlpackage/Manifest.json" ]; then ok "depth model present"; else miss "depth model not downloaded (optional)"; fi
    step "Result"
    if [ $missing = 0 ]; then ok "everything is in place"; else miss "run without --check to install what is missing"; fi
    exit 0
  fi

  cd "$DIR"
  step "Packages"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
  ok "installed"
  [ -f places.json ] || { cp places.example.json places.json; ok "created places.json (known places for the GPS sorter)"; }

  if [ $DEPTH = 1 ]; then
    step "Depth model (Depth Anything V2 Small, Apple's Core ML build, 48 MB)"
    local m=".cache/models/DepthAnythingV2SmallF16.mlpackage" entry f sum got
    for entry in "${MODEL_FILES[@]}"; do
      f=${entry% *}; sum=${entry##* }
      if [ -f "$m/$f" ] && [ "$(shasum -a 256 "$m/$f" | cut -c1-64)" = "$sum" ]; then continue; fi
      mkdir -p "$(dirname "$m/$f")"
      curl -fsSL --retry 3 -o "$m/$f.part" "$MODEL_URL/$f"
      got=$(shasum -a 256 "$m/$f.part" | cut -c1-64)
      [ "$got" = "$sum" ] || { rm -f "$m/$f.part"; fail "checksum mismatch for $f (expected $sum, got $got)"; }
      mv "$m/$f.part" "$m/$f"
    done
    ok "downloaded and verified"
  fi

  step "Self-check"
  npm run --silent typecheck >/dev/null && ok "TypeScript compiles"
  mkdir -p .cache/bin
  swiftc -O scripts/saliency.swift -o .cache/saliency 2>/dev/null && ok "Swift vision tool builds (Apple Vision)" \
    || fail "the Swift vision tool did not compile. Check the Xcode command-line tools: xcode-select --install"
  python3 -c 'import numpy, PIL' && ok "Python analysis modules import"

  printf '\n%sJauntcut is ready in %s%s\n\n' "$G$B" "$DIR" "$N"
  cat <<EOF
Make your first reel:

  cd $DIR
  npm run new my-first-reel        # creates topics/my-first-reel/
  # put photos and videos in topics/my-first-reel/raw/ and one song in topics/my-first-reel/music/
  npm run media my-first-reel      # converts media and finds the beat
  # list your clips in topics/my-first-reel/reel.ts
  npm run studio                   # preview in the browser
  npm run render my-first-reel     # checks, then renders out/my-first-reel.mp4

Footage should be at least 1080x1920 (vertical), and a reel runs 20-45 seconds.
npm run render checks the edit first and tells you exactly what to change.

Guide: https://jauntcut.com/start
EOF
}

main "$@"
