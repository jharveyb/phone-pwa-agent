#!/usr/bin/env bash
# Drive the installed PWA (WebAPK) from the laptop. Usage: phone-pwa.sh launch|kill|restart
# The WebAPK package is auto-detected (the one whose apk mentions phone-agent); override with PWA_PKG=...
set -euo pipefail
pkg="${PWA_PKG:-}"
if [ -z "$pkg" ]; then
  for p in $(adb shell pm list packages | grep -i webapk | sed 's/package://'); do
    apk=$(adb shell pm path "$p" | head -1 | sed 's/package://')
    if adb shell "strings $apk 2>/dev/null | grep -q phone-agent"; then pkg=$p; break; fi
  done
fi
[ -n "$pkg" ] || { echo "no phone-agent WebAPK found (install via Chrome 'Add to Home screen' first)" >&2; exit 1; }
case "${1:-}" in
  launch)  adb shell input keyevent KEYCODE_WAKEUP >/dev/null; adb shell cmd statusbar collapse >/dev/null 2>&1 || true
           adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; echo "launched $pkg";;
  kill)    adb shell am force-stop com.android.chrome; adb shell am force-stop "$pkg"; echo "killed chrome + $pkg";;
  restart) "$0" kill; sleep 2; "$0" launch;;
  *) echo "usage: $0 launch|kill|restart" >&2; exit 2;;
esac
