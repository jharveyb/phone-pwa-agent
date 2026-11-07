#!/usr/bin/env bash
# Forward Chrome's DevTools socket to localhost:9222 and list inspectable pages (JSON).
set -euo pipefail
adb forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null
curl -s http://127.0.0.1:9222/json | jq -r '.[] | select(.type=="page" or .type=="worker") | "\(.type)\t\(.id)\t\(.url)"'
