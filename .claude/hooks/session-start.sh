#!/bin/bash
# Claude Code on the web only: install test dependencies and make sure the
# Playwright browser smoke tests (test:designs, test:admin, test:tv) can launch.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Install exactly what package-lock.json pins; skipped once installed.
if [ ! -d node_modules/playwright ]; then
  npm ci --no-audit --no-fund
fi

# The cloud image ships a pre-installed Chromium, and downloading browsers is
# not allowed there. When the pinned Playwright expects a different build,
# point its expected headless-shell path at the newest pre-installed one.
browsers="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$browsers" ] || [ ! -d "$browsers" ]; then
  exit 0
fi
rev=$(node -e "const b=JSON.parse(require('fs').readFileSync('node_modules/playwright-core/browsers.json','utf8')).browsers;console.log(b.find(x=>x.name==='chromium-headless-shell').revision)")
want="$browsers/chromium_headless_shell-$rev/chrome-headless-shell-linux64/chrome-headless-shell"
if [ -e "$want" ]; then
  exit 0
fi
have=$(ls -d "$browsers"/chromium_headless_shell-*/chrome-linux/headless_shell \
             "$browsers"/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null \
       | grep -v "chromium_headless_shell-$rev/" | sort -V | tail -1 || true)
if [ -z "$have" ]; then
  echo "session-start: no pre-installed Chromium headless shell found; browser smoke tests will not run" >&2
  exit 0
fi
mkdir -p "$(dirname "$want")"
ln -sf "$have" "$want"
echo "session-start: Playwright expects headless shell $rev; linked $have"
