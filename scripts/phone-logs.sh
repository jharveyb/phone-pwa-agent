#!/usr/bin/env bash
# Stream the agent page's console (via Chrome DevTools Protocol over adb). Ctrl-C to stop.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/cdp.mjs logs "$@"
