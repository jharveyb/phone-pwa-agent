#!/usr/bin/env bash
# Evaluate a JS expression in the agent page on the phone. Usage: phone-eval.sh 'document.title'
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/cdp.mjs eval "$@"
