#!/usr/bin/env bash
# Hard reload: kill Chrome and re-open the page (module state is really gone, unlike HMR).
set -euo pipefail
cd "$(dirname "$0")/.." && . scripts/env.sh
adb shell am force-stop "$CHROME_PKG"
sleep 1
exec scripts/phone-open.sh "${1:-$PAGE_URL}"
