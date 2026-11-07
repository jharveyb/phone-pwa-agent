#!/usr/bin/env bash
# Rebuild the patched tailscale-web WASM (adds `authKey` init option). Output: vendor/tailscale-web/dist/main.wasm
set -euo pipefail
cd "$(dirname "$0")/../vendor/tailscale-web"
export GOFLAGS=-mod=mod GOOS=js GOARCH=wasm CGO_ENABLED=0
time go build -ldflags='-s -w' -o src/wasm/main.wasm .
cp src/wasm/main.wasm dist/main.wasm
ls -la dist/main.wasm
