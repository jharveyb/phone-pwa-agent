import { defineConfig } from "vite";

// Served to the phone over HTTPS by `tailscale serve --bg 5173` on the laptop.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // tailscale serve forwards Host: laptop.<tailnet>.ts.net; Vite blocks unknown hosts by default.
    allowedHosts: [".ts.net"],
    hmr: { protocol: "wss", clientPort: 443 },
  },
  build: { target: "es2022" },
  worker: { format: "es" },
});
