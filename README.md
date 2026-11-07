# phone-agent

A [Pi](https://github.com/earendil-works/pi) coding agent that runs **inside a Chrome tab on a headless Pixel 6** and is
driven entirely from a laptop over Tailscale.

- **Agent**: `@earendil-works/pi-agent-core` `Agent` + `@earendil-works/pi-ai` (OpenAI-compatible provider pointed at
  [Tinfoil](https://tinfoil.sh)). Runs in a dedicated Web Worker.
- **Tools**: `read`/`write`/`edit`/`bash`/`ls` (pi's schemas) on a `BrowserExecutionEnv` = [just-bash](https://github.com/vercel-labs/just-bash)
  (TypeScript bash interpreter) + in-memory filesystem, plus `web_fetch` that egresses through the tailnet.
- **Network**: the tab is its own tailnet node via [tailscale-web](https://github.com/adrianosela/tailscale-web)
  (WASM tailscaled in a second worker, auth-key login, `listenTCP`) and serves a tiny HTTP/SSE control API **directly
  on its tailnet IP**. No relay server.
- **Persistence**: filesystem snapshots + session transcript in OPFS, restored on boot; Tailscale node state in IndexedDB.
- **Keep-alive**: screen wake lock, Web Lock, PWA manifest + service worker, heartbeat in `/state`.

Status, measurements and dead ends: [NOTES.md](NOTES.md).

## Layout
```
src/main.ts            status page + router: tailscale worker <-> agent worker, SSE, keep-alive
src/ts-worker.ts       tailscale-web node, HTTP server on tailnet port 8080, web fetch (+ exit node)
src/agent-worker.ts    pi Agent + Tinfoil provider + tools + OPFS persistence
src/env/browser-env.ts BrowserExecutionEnv (just-bash + InMemoryFs, snapshot/restore)
src/tools/             read/write/edit/bash/ls + web_fetch (pi AgentTool implementations)
src/http.ts            minimal HTTP/1.1 parser + response/SSE helpers
vendor/tailscale-web/  fork: adds `authKey` init option (see scripts/build-tsweb.sh)
scripts/               laptop-side tooling (adb, DevTools protocol, control API clients, watchdog)
test/                  vitest (env + tools, runs in Node)
```

## Setup (laptop)
Prereqs: [Determinate Nix](https://determinate.systems/nix), the laptop and the phone on the same tailnet, wireless or
USB ADB debugging paired with the phone.

```sh
nix develop                # or `direnv allow`; provides node, pnpm, go, adb, tailscale, jq, curl
pnpm install
scripts/build-tsweb.sh     # one-time: build the patched tailscale-web wasm (~1 min, needs network for Go modules)
cp .env.example .env       # then fill in the secrets (git-ignored)
pnpm dev                   # Vite on 127.0.0.1:5173
tailscale serve --bg 5173  # https://<laptop>.<tailnet>.ts.net/ (HTTPS = secure context on the phone)
```
`.env`:
```
TS_AUTHKEY=tskey-auth-...      # pre-authorized, reusable Tailscale auth key for the browser node
TS_HOSTNAME=pwa-agent          # tailnet name of the browser node
TS_EXIT_NODE=my-exit-node     # optional: tailnet exit node used by web_fetch for the public internet
TINFOIL_API_KEY=tk_...
TINFOIL_MODEL=deepseek-v4-1-flash
TINFOIL_ATTEST=1               # optional: Tinfoil SDK enclave attestation + encrypted request bodies
```
Secrets reach the phone through a tailnet-only `/__config.json` endpoint served by the dev server; nothing is typed on the phone.

## Run
```sh
scripts/phone-open.sh                 # open https://<laptop>.<tailnet>.ts.net/ in Chrome on the phone (adb)
scripts/phone-logs.sh                 # stream the page + worker consoles (tailscaled logs included)
scripts/state.sh                      # GET /state from the phone's tailnet IP
scripts/ask.sh "list the home dir"    # POST /prompt + follow the SSE event stream
scripts/watchdog.sh 30                # alert (notify-send / NTFY_TOPIC) when the heartbeat stops
scripts/phone-reload.sh [--purge]     # force-stop Chrome and reopen (real reload, tests persistence); --purge drops the SW wasm cache
scripts/phone-mem.sh                  # Chrome PSS on the phone
```
Control API (plain HTTP on `http://<node>:8080`, tailnet only):

| Method | Path | |
|---|---|---|
| GET | `/state` | heartbeat, visibility, wake lock, tailscale node, agent state, persistence |
| POST | `/prompt` | `{"text": "..."}` → 202; queued as follow-up if the agent is busy |
| POST | `/steer` | inject a message mid-run |
| POST | `/abort` | abort the current run |
| POST | `/restart` | terminate + respawn the agent worker (state restored from OPFS) |
| POST | `/session/clear` | drop the transcript (keeps files) |
| POST | `/fetch` | `{"url": "..."}` debug: fetch through the tailscale node without the LLM |
| GET | `/events?since=N` | SSE: replay events after N, then live |
| GET | `/log` | page log |

Faster dev loop over USB (avoids the 34 MB wasm download over DERP): `adb reverse tcp:5173 tcp:5173`, then
`scripts/phone-open.sh http://localhost:5173/` (localhost is a secure context; separate storage origin; no HMR).

## Phone-side one-offs (manual)
Stay-awake while charging (`adb shell settings put global stay_on_while_plugged_in 7`), battery unrestricted for
Chrome, Chrome "Add to Home screen" (then open the installed app, which also makes `storage.persist()` stick), app
pinning. Everything else is driven from the laptop.

## Tests
```sh
pnpm test      # vitest: BrowserExecutionEnv + tools in Node
pnpm build     # tsc + vite build (browser bundle incl. the wasm)
```
