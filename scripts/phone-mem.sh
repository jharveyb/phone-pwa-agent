#!/usr/bin/env bash
# Memory of Chrome processes on the phone (PSS, MB) + device-wide availability.
set -euo pipefail
echo "== device =="; adb shell cat /proc/meminfo | grep -E 'MemTotal|MemAvailable'
echo "== chrome processes (PSS MB) =="
adb shell ps -A -o PID,NAME | grep 'com.android.chrome' | while read -r pid name; do
  pss=$(adb shell dumpsys meminfo "$pid" 2>/dev/null | grep -E '^\s+TOTAL PSS:' | awk '{print $3}')
  printf "%6d MB  pid=%s %s\n" "$(( ${pss:-0} / 1024 ))" "$pid" "$name"
done | sort -rn
