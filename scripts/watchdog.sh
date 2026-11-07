#!/usr/bin/env bash
# Laptop-side watchdog: polls the phone agent's /state and alerts when the heartbeat stops or the tab lost its
# wake lock / visibility. Alerts via desktop notify-send and/or ntfy (set NTFY_TOPIC). Usage: watchdog.sh [interval_s]
set -uo pipefail
cd "$(dirname "$0")/.." && . scripts/api.sh
interval="${1:-30}"; fails=0; last_ok=""
alert() {
  echo "[$(date -Is)] ALERT: $*" >&2
  command -v notify-send >/dev/null && notify-send -u critical "phone-agent" "$*" || true
  [ -n "${NTFY_TOPIC:-}" ] && curl -s -m 10 -d "phone-agent: $*" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || true
}
echo "watching $PHONE_API every ${interval}s (Ctrl-C to stop)" >&2
while true; do
  if st=$(curl -sf -m 10 "$PHONE_API/state"); then
    hb=$(jq -r .heartbeat <<<"$st"); vis=$(jq -r .visibility <<<"$st"); wl=$(jq -r .wakeLock <<<"$st")
    busy=$(jq -r '.agent.isStreaming' <<<"$st"); up=$(jq -r .uptimeS <<<"$st"); msgs=$(jq -r '.agent.messages' <<<"$st")
    echo "[$(date +%T)] ok up=${up}s vis=$vis wakeLock=$wl busy=$busy msgs=$msgs hb=$hb"
    [ "$vis" != "visible" ] && alert "tab not visible ($vis)"
    [ "$wl" != "true" ] && alert "wake lock not held"
    [ $fails -gt 0 ] && alert "phone agent is back after $fails failed polls"
    fails=0; last_ok=$(date +%s)
  else
    fails=$((fails+1)); echo "[$(date +%T)] FAIL #$fails (no /state)"
    [ $fails -eq 3 ] && alert "no heartbeat for $((3*interval))s (last ok: ${last_ok:-never})"
  fi
  sleep "$interval"
done
