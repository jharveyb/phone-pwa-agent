# shared: base URL of the phone's control API (tailnet). Override with PHONE_API=http://host:port
if [ -z "${PHONE_API:-}" ]; then
  _st=$(tailscale status --json 2>/dev/null)
  # newest online tailnet peer that is a browser node ("js") named pwa-agent*
  _ip=$(jq -r '[.Peer[] | select(.OS=="js" and .Online and (.HostName|startswith("pwa-agent")))] | sort_by(.LastSeen) | last | .TailscaleIPs[0] // empty' <<<"$_st")
  _suffix=$(jq -r '.MagicDNSSuffix // empty' <<<"$_st")
  PHONE_API="http://${_ip:-pwa-agent${_suffix:+.$_suffix}}:8080"
fi
