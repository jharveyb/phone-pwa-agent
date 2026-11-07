#!/usr/bin/env bash
# Send a prompt to the agent on the phone and stream its events until the run ends.
# Usage: ask.sh "prompt text"      (env PHONE_API to override the base URL)
set -euo pipefail
cd "$(dirname "$0")/.." && . scripts/api.sh
[ $# -ge 1 ] || { echo "usage: $0 \"prompt\"" >&2; exit 2; }
seq=$(curl -sf "$PHONE_API/state" | jq -r '.agent.eventSeq // 0')
resp=$(curl -sf -X POST "$PHONE_API/prompt" -H 'content-type: application/json' --data-binary "$(jq -cn --arg t "$1" '{text:$t}')") || { echo "prompt rejected: $resp" >&2; exit 1; }
echo "accepted (events after seq $seq)" >&2
fifo=$(mktemp -u); mkfifo "$fifo"; trap 'kill $cpid 2>/dev/null; rm -f "$fifo"' EXIT
curl -sN "$PHONE_API/events?since=$seq" > "$fifo" & cpid=$!
while IFS= read -r l; do
  case "$l" in
    data:*) d="${l#data: }"
      case "$(jq -r .type <<<"$d" 2>/dev/null)" in
        tool_execution_start) echo "→ $(jq -r '.toolName + " " + (.args|tostring|.[0:160])' <<<"$d")";;
        tool_execution_end)   echo "← $(jq -r '.toolName + " isError=" + (.isError|tostring) + " " + ((.result.content[0].text // "")|tostring|.[0:300]|gsub("\n";"⏎"))' <<<"$d")";;
        turn_end)             jq -r 'select(.message.role=="assistant") | ([.message.content[]? | select(.type=="text") | .text] | join("")) as $t | if $t != "" then "🤖 " + $t else empty end' <<<"$d"
                              jq -r 'select(.message.role=="assistant") | "   (in=\(.message.usage.input) out=\(.message.usage.output) stop=\(.message.stopReason))"' <<<"$d";;
        error)                echo "ERROR: $(jq -r .text <<<"$d")";;
        agent_end)            echo "done."; break;;
      esac;;
  esac
done < "$fifo"
