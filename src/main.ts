import { loadConfig } from "./config";

const status = document.getElementById("status")!;
const log = document.getElementById("log")!;
function line(s: string) {
  log.textContent += `[${new Date().toISOString().slice(11, 19)}] ${s}\n`;
  console.log(s);
}
line(`hello from phone-agent; secureContext=${window.isSecureContext}`);
line(`OPFS=${!!navigator.storage?.getDirectory} wakeLock=${"wakeLock" in navigator} locks=${"locks" in navigator} SW=${"serviceWorker" in navigator}`);
const boot = Date.now();
setInterval(() => (status.textContent = `alive ${Math.round((Date.now() - boot) / 1000)}s, ${new Date().toISOString()}`), 1000);

(window as any).__pa = { tsReady: false, tsIp4: "", tsListening: false, tsInitMs: 0, tsErrors: [] as string[] };

async function main() {
  const cfg = await loadConfig();
  line(`config: tsAuthKey=${cfg.tsAuthKey ? "set" : "MISSING"} tinfoilApiKey=${cfg.tinfoilApiKey ? "set" : "MISSING"} hostname=${cfg.tsHostname}`);
  const ts = new Worker(new URL("./ts-worker.ts", import.meta.url), { type: "module", name: "tailscale" });
  ts.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "log") line(m.text);
    else if (m.type === "ready") Object.assign((window as any).__pa, { tsReady: true, tsIp4: m.ip4, tsInitMs: m.initMs });
    else if (m.type === "listening") (window as any).__pa.tsListening = true;
    else if (m.type === "error") (window as any).__pa.tsErrors.push(m.text);
    else if (m.type === "tsStatus") line(`status:\n${m.text}`);
  };
  ts.onerror = (e) => line(`ts worker error: ${e.message}`);
  ts.postMessage({ type: "init", authKey: cfg.tsAuthKey, hostname: cfg.tsHostname, port: 8080 });
}
main().catch((e) => line(`main failed: ${e}`));
