#!/usr/bin/env bash
# Demo: a pi agent running inside a Chrome tab on the phone, driven from the laptop over Tailscale.
# 1) where it runs  2) a task that uses web_fetch (via tailnet exit node) + python (Pyodide) + the in-browser fs
# 3) persistence: reload the tab, ask about the file it wrote.
set -euo pipefail
cd "$(dirname "$0")/.." && . scripts/api.sh
step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
step "the agent's node (a Chrome tab on the phone) as seen by tailscale"
tailscale status | grep ' js ' || true
step "GET /state"
curl -sf "$PHONE_API/state" | jq '{heartbeat, uptimeS, wakeLock, ts: .ts.ip4, model: .agent.model, attested: .agent.attestation.verified, messages: .agent.messages}'
step "chat UI for any browser on the tailnet: $PHONE_API/ui"
step "task: web_fetch (through a tailnet exit node) + python (CPython/WASM sandbox) + files"
scripts/ask.sh "Use web_fetch on https://api.github.com/repos/earendil-works/pi (raw=true), then use the python tool to parse that JSON and print the repo's description, stargazers_count and pushed_at, and write a 3-line report.md with those. One sentence reply."
step "persistence: reload the tab on the phone (soft), then ask about the file"
scripts/phone-reload.sh --soft >/dev/null; sleep 12
scripts/ask.sh "Read report.md and reply with its first line only."
step "done — everything above ran inside the browser tab on the phone"
