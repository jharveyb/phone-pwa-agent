# NOTES — running log (findings, dead ends, numbers)

## Environment (2026-11-07)
- Laptop: `laptop` = 100.x.x.x = `laptop.TAILNET.ts.net` (Debian testing, tailscale 1.104.5).
- Phone: Pixel 6 (oriole), Android 17 (patch 2026-10-05), Chrome 153.0.8010.53, 7.4 GB RAM.
  Tailscale Android app installed and up: tun0 = 100.x.x.x (`google-pixel-6.TAILNET.ts.net`).
  `tailscale status` on the laptop showed it "offline" while it was pinging fine — status is stale, don't trust it for the phone.
  Phone→laptop ping over tailnet: ~205 ms RTT (probably DERP-relayed; keep in mind for the control API).
- Wireless ADB: paired and working (`adb-PHONESERIAL-xxxxxx._adb-tls-connect._tcp`). The nix `android-tools` adb client
  talks to the already-running host adb server; fine.
- `stay_on_while_plugged_in` was already 15 (AC|USB|wireless|dock). AC powered, level 93%, awake.
- Nix dev shell: node v22.23.4, pnpm 12.9.0, vite 8.3.6, typescript 7.0.2, vitest 5.1.0.

## Step 1 — skeleton (done)
- `tailscale serve --bg 5173` → https://laptop.TAILNET.ts.net/ proxies to Vite on 127.0.0.1:5173. Vite needs
  `server.allowedHosts: ['.ts.net']` (host check) and `hmr: {protocol: 'wss', clientPort: 443}`.
- Page on the phone: `isSecureContext=true`, OPFS/wakeLock/Web Locks/SW all present. Idle heap 9.5 MB.
- Release Chrome on Android does NOT mirror `console.log` to logcat. Use the DevTools protocol instead:
  `scripts/cdp.mjs` (adb forward → localabstract:chrome_devtools_remote → ws). `phone-logs.sh` streams console,
  `phone-eval.sh` evaluates JS in the page, `cdp.mjs heap` reads `performance.memory`.
- Chrome UA on the page is frozen ("Android 10; K") — don't use it for anything.

## Step 2/3 prep — package reality check (2026-11-07, pi 1.5.0)
Discrepancies vs the brief (followed upstream's actual API, no forks):
- `@earendil-works/pi-agent-core@1.5.0` exports only `Agent`, `agentLoop*`, `runToolCall`, `streamProxy`, `setDefaultStreamFn`
  + types. **There is no `ExecutionEnv` / `FileSystem` / `Shell` abstraction and no `/node` subpath.**
- The tool factories (`createReadTool(cwd, opts)`, `createWriteTool`, `createEditTool`, `createBashTool`, `createLsTool`,
  grep/find) live in `@earendil-works/pi-coding-agent` (`dist/core/tools/*.js`). The pluggable seam there is per-tool
  `options.operations` (`ReadOperations{readFile,access}`, `WriteOperations{writeFile,mkdir}`,
  `EditOperations{readFile,writeFile,access}`, `LsOperations{exists,stat,readdir}`,
  `BashOperations{exec(command,cwd,{onData,signal,timeout,env}) → {exitCode}}`) — that's the "ExecutionEnv" the Rust
  port / browser-loop were mirroring.
- BUT those modules are not browser-importable: each imports `fs`/`fs/promises`/`node:path` at module level AND their
  renderers import `@earendil-works/pi-tui` (terminal), `chalk`, `config.js` (homedir, child_process), `image-resize.js`
  (`node:worker_threads`). The package exports map also only exposes `.` and `./rpc-entry`. Stubbing ~15 modules
  for a hackathon is not worth it → **decision: implement the 5 tools ourselves as `AgentTool`s (pi-agent-core's
  interface), copying pi's schemas/descriptions, on top of `BrowserExecutionEnv` (just-bash `Bash` + `InMemoryFs`).**
  Zero upstream edits; the Agent class doesn't care where tools come from.
- pi-ai model wiring for Tinfoil: `createModels()` + `createProvider({id:"tinfoil", baseUrl:"https://inference.tinfoil.sh/v1",
  auth:{apiKey:{name, resolve}}, models:[{api:"openai-completions", ...}], api: openAICompletionsApi()})` from
  `@earendil-works/pi-ai/api/openai-completions.lazy`; `models.streamSimple` satisfies Agent's `StreamFn`;
  `ProviderRequestOptions.apiKey` exists for passing the key per request.
- `tailscale-web@0.1.18`: JS wrapper is 22 KB + 35 MB `main.wasm` (`new URL("main.wasm", import.meta.url)`, so
  `optimizeDeps.exclude`). `init(opts)` passes the options object straight to Go (`globalThis.__tailscaleWeb.init`).
  `InitOptions` typings have no auth key, but the wasm contains the string `authKey` (2×) → tsconnect-style
  `authKey` config is probably honoured; verifying empirically in Spike A. Storage adapter is sync `get/set` →
  `src/ts-storage.ts` preloads IndexedDB into a Map (workers have no localStorage).
- `just-bash@3.6.0`: `just-bash/browser` entry; `new Bash({fs, cwd, env, customCommands, executionLimits})`,
  `bash.exec(cmd) → {stdout, stderr, exitCode}`, `bash.fs: IFileSystem` (readFile/writeFile/mkdir/readdir/stat/exists/
  getAllPaths…). Only gzip needs node:zlib.

## Spike B — pi in a worker on the phone (done, passes)
- `vite build` for browser: only `node:fs` (pi-ai provider-env.js) and `node:zlib` (just-bash gzip) externalized —
  call-time only, no import-time failure. No `bun:*` references. Chunks: openai-completions 311 KB, just-bash 1.27 MB.
- Probe worker on the Pixel (dev mode, unbundled): pi-agent-core import 829 ms, pi-ai 39 ms, openai-completions.lazy
  15 ms, just-bash/browser 8.2 s (first load, hundreds of unbundled modules — fine in a built bundle), `Agent` constructs,
  `bash.exec("echo $((6*7)); cat hello.txt | tr a-z A-Z; ls -la")` works. `uname` is not a command (expected).
- Dedicated workers don't appear in `/json` of the DevTools socket; heap numbers via `cdp.mjs heap` are main-realm only.
  TODO: Target.setAutoAttach for worker heaps if we need them.

## Spike A — tailscale-web on the phone (in progress)
- `tailscale-web@0.1.18` has **no auth-key support**: `main.go initFn` reads only hostname/storage/storagePrefix/
  controlUrl/onAuthRequired/onAuthComplete, then `backend.Start(ipn.Options{UpdatePrefs})` → interactive login URL
  within ~3 s on the phone (wasm instantiate + control handshake). Verified against the repo source, not just typings.
- Fix = ~10 lines in `vendor/tailscale-web` (Apache-2.0 fork, `pnpm add tailscale-web@link:vendor/tailscale-web`):
  `Config.AuthKey`, `opts.Get("authKey")`, `backend.Start(ipn.Options{UpdatePrefs, AuthKey})` — exactly what tsnet
  does — and skip `StartLoginInteractive` when a key is given. TODO: upstream as a PR.
- Rebuilding the wasm had three traps: (1) go.mod `replace tailscale.com => ../../tailscale/tailscale` points at the
  author's *private* fork; the only thing it adds is `_ "tailscale.com/feature/webrtc"` (WebRTC peer paths for
  browsers), which isn't in the public `adrianosela/tailscale` fork either → dropped the import, build against upstream
  tailscale v1.102.3 = DERP-only like upstream tsconnect. (2) Go 1.27 + `GOOS=js` fails in `os/user` unless
  `CGO_ENABLED=0` (nix sets CC, so cgo looks enabled for the cross-compile). (3) Vite's module graph kept serving the
  old `/node_modules/.pnpm/...` path for the *worker* URL after the dependency became a symlink — restart Vite and
  `rm -rf node_modules/.vite`. `scripts/build-tsweb.sh` does the build (~10 s incremental, go 1.27.3; output 33.9 MB).
- Go-side `log.Printf` lines show up in the page console as `[log:info]`, so `scripts/phone-logs.sh` gives tailscaled
  logs (control: RegisterReq, authURL, state transitions). Very handy.
- **RESULT (2026-11-07 13:35): Spike A passes.** Key fix on top of the above: `ipn.Options{AuthKey}` alone does *not*
  log in on v1.102 — tsnet also calls `backend.StartLoginInteractive(ctx)` afterwards; because the control client was
  created with the key, that "interactive" login registers with the key and never emits an auth URL. Numbers (Pixel 6,
  Chrome 153, page served over USB `adb reverse` to avoid the DERP download):
  - wasm module import 65 ms (cached), `network.init()` with auth key **4.1 s** (fresh state → registered, IPs assigned),
    `listenTCP(8080)` immediate. Node shows up as `pwa-agent` (OS `js`) in `tailscale status`.
  - From the laptop: `curl http://pwa-agent.TAILNET.ts.net:8080/` → 200 in **120–160 ms**, path = DERP(nyc)
    (`tailscale ping`: "direct connection not established" — expected, browser nodes have no UDP; the WebRTC paths
    the author's private fork adds would fix that).
  - First download of the 34 MB wasm over the tailnet-served page took ~3.7 min (DERP-relayed phone link ≈150 KB/s);
    cached by Chrome afterwards. Dev loop: `adb reverse tcp:5173 tcp:5173` + `http://localhost:5173/` (localhost is a
    secure context, so OPFS/wake lock/SW all work; different origin ⇒ separate IDB/OPFS state from the ts.net origin).
  - Chrome browser process PSS ≈ 209 MB with the node up; renderer breakdown via `scripts/phone-mem.sh`.

## Steps 5–7 — control API, persistence, keep-alive (done 2026-11-07 13:45)
- Control API = `src/http.ts` (tiny HTTP/1.1 parser: request line, headers, Content-Length body, one request per
  connection) inside the tailscale worker; requests are posted to the main thread router (`src/main.ts`), replies go
  back by id; SSE keeps the TCP connection open and streams agent events (+15 s heartbeats). `scripts/ask.sh` = POST
  /prompt then follow `/events?since=N` until `agent_end`; `scripts/state.sh` = GET /state.
  Gotcha: everything crossing `postMessage` must be structured-cloneable (URLSearchParams is not).
- Latency laptop→phone-tab API: ~130–160 ms per request (DERP nyc). A 4-LLM-call agent run via ask.sh: 3.9 s wall.
- Persistence (agent worker, OPFS): `fs-snapshot.json` = full InMemoryFs tree (base64 files; ~24 KB with just-bash's
  default layout of ~176 files) written after every tool call via sync access handle + `move()` (atomic-ish), and
  every 30 s if dirty; `session.jsonl` = every `message_end` message appended; replay = `initialState.messages`
  (system messages filtered, dangling `toolUse` assistant tail dropped). Verified with a real force-stop reload: 4
  messages + files restored, agent read the pre-reload file. `POST /session/clear` drops the transcript only.
  TODO: no compaction yet — long sessions will blow the 128k context; wire pi-coding-agent's `compact()` or truncate.
- Keep-alive: wake lock re-acquired on visibilitychange; Web Lock held for the page lifetime; `/manifest.webmanifest`
  + `/sw.js` (cache-first for main.wasm only); `storage.persist()` => **false** on both origins so far (Chrome grants it
  for installed PWAs / sites with notification permission — needs the owner's taps). `/state` carries a heartbeat.
- Dev loop note: on the `http://localhost:5173` (adb reverse) origin HMR is dead (the client dials wss://…:443), so
  use `scripts/phone-reload.sh http://localhost:5173/` after edits. Each `?reset=ts` registers a NEW tailnet node.
