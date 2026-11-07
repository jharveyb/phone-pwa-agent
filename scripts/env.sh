# shared by scripts/*.sh — source it
TS_HOST="${TS_HOST:-$(tailscale status --self --json | jq -r '.Self.DNSName' | sed 's/\.$//')}"
PAGE_URL="${PAGE_URL:-https://${TS_HOST}/}"
CHROME_PKG="com.android.chrome"
