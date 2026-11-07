# shared: base URL of the phone's control API (tailnet). Override with PHONE_API=http://host:port
if [ -z "${PHONE_API:-}" ]; then
  _ip=$(tailscale status --json 2>/dev/null | jq -r '[.Peer[] | select(.OS=="js" and .Online and (.HostName|startswith("pwa-agent")))] | sort_by(.LastSeen) | last | .TailscaleIPs[0] // empty')
  PHONE_API="http://${_ip:-pwa-agent.TAILNET.ts.net}:8080"
fi
