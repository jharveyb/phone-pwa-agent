#!/usr/bin/env bash
# GET /state from the phone agent (pretty JSON). Usage: state.sh [jq filter]
set -euo pipefail
cd "$(dirname "$0")/.." && . scripts/api.sh
curl -sf "$PHONE_API/state" | jq "${1:-.}"
