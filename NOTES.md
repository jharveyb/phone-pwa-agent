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
