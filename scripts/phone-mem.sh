#!/usr/bin/env bash
# Memory of Chrome processes on the phone (PSS, MB) + device-wide availability.
set -euo pipefail
echo "== device =="; adb shell cat /proc/meminfo | grep -E 'MemTotal|MemAvailable'
echo "== chrome processes (PSS) =="
for p in $(adb shell pidof com.android.chrome; adb shell pgrep -f 'com.android.chrome:' ); do
  name=$(adb shell cat /proc/$p/cmdline 2>/dev/null | tr '\0' ' ' | cut -c1-60)
  pss=$(adb shell dumpsys meminfo "$p" 2>/dev/null | grep -E '^\s+TOTAL PSS:' | awk '{print $3}')
  echo "pid=$p pss_kb=${pss:-?} $name"
done | sort -u
