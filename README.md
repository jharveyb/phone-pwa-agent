# phone-agent

An in-browser [Pi](https://github.com/earendil-works/pi) agent that runs indefinitely in a Chrome tab on a headless
Pixel 6, controlled from a laptop over Tailscale. Shell + filesystem tools run in the browser (just-bash + in-memory fs
snapshotted to OPFS); the LLM is Tinfoil.

## Dev
```
nix develop            # or direnv allow
pnpm install
pnpm dev               # vite on 127.0.0.1:5173
tailscale serve --bg 5173   # → https://<laptop>.<tailnet>.ts.net/
scripts/phone-open.sh  # open on the phone (adb)
scripts/phone-logs.sh  # stream the page console
```
Secrets go in a git-ignored `.env` (`TINFOIL_API_KEY`, `TS_AUTHKEY`).
