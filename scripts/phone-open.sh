#!/usr/bin/env bash
# Open (or re-open) the agent page in Chrome on the phone. Usage: phone-open.sh [url]
set -euo pipefail
cd "$(dirname "$0")/.." && . scripts/env.sh
url="${1:-$PAGE_URL}"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null
adb shell am start -a android.intent.action.VIEW -d "'$url'" "$CHROME_PKG" >/dev/null
echo "opened $url"
