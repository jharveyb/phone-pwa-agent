#!/usr/bin/env bash
# Hard reload: kill Chrome and re-open the page (module state is really gone, unlike HMR).
# Usage: phone-reload.sh [--purge] [url]   (--purge: drop the service-worker asset cache first, e.g. after a wasm rebuild)
set -euo pipefail
cd "$(dirname "$0")/.." && . scripts/env.sh
if [ "${1:-}" = "--purge" ]; then
  shift
  node scripts/cdp.mjs eval --url "${1:-$PAGE_URL}" 'caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))).then(()=>"sw caches purged")' 2>/dev/null || true
fi
adb shell am force-stop "$CHROME_PKG"
sleep 1
exec scripts/phone-open.sh "${1:-$PAGE_URL}"
