import { readFileSync, existsSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/** Serve git-ignored secrets from .env as JSON so the phone needs no typing. Tailnet-only via tailscale serve. */
function configEndpoint(): Plugin {
  return {
    name: "phone-agent-config",
    configureServer(server) {
      server.middlewares.use("/__config.json", (_req, res) => {
        const env: Record<string, string> = {};
        if (existsSync(".env")) {
          for (const line of readFileSync(".env", "utf8").split("\n")) {
            const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
            if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
          }
        }
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(
          JSON.stringify({
            tsAuthKey: env.TS_AUTHKEY ?? null,
            tsHostname: env.TS_HOSTNAME ?? "pixel-agent",
            tinfoilApiKey: env.TINFOIL_API_KEY ?? null,
            tinfoilModel: env.TINFOIL_MODEL ?? null,
            tsExitNode: env.TS_EXIT_NODE ?? null,
            tinfoilAttest: env.TINFOIL_ATTEST === "1", // opt-in: Tinfoil SDK enclave attestation + encrypted bodies // hostname of a tailnet exit node for web_fetch (optional)
          }),
        );
      });
    },
  };
}

// Served to the phone over HTTPS by `tailscale serve --bg 5173` on the laptop.
export default defineConfig({
  plugins: [configEndpoint()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // tailscale serve forwards Host: laptop.<tailnet>.ts.net; Vite blocks unknown hosts by default.
    allowedHosts: [".ts.net"],
    hmr: { protocol: "wss", clientPort: 443 },
  },
  // tailscale-web locates main.wasm via new URL("main.wasm", import.meta.url); keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ["tailscale-web"] },
  build: { target: "es2022" },
  worker: { format: "es" },
});
