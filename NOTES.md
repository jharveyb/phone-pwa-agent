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
