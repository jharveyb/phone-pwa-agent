#!/usr/bin/env node
// Minimal Chrome DevTools Protocol client for the phone's Chrome (via `adb forward`).
// Usage:
//   cdp.mjs targets                 list page/worker targets
//   cdp.mjs eval  [--url substr] <js-expression>   evaluate in the page (awaits promises)
//   cdp.mjs logs  [--url substr]    stream console + exceptions until Ctrl-C
//   cdp.mjs heap  [--url substr]    JS heap usage of the page's main realm
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const cmd = args.shift();
let urlFilter = "ts.net";
const i = args.indexOf("--url");
if (i >= 0) { urlFilter = args[i + 1]; args.splice(i, 2); }

execSync("adb forward tcp:9222 localabstract:chrome_devtools_remote", { stdio: "ignore" });
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
if (cmd === "targets") {
  for (const t of targets) console.log(`${t.type}\t${t.id}\t${t.url}`);
  process.exit(0);
}
const target = targets.find((t) => t.type === "page" && t.url.includes(urlFilter));
if (!target) { console.error(`no page target matching ${urlFilter}`); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    console.log(`[${msg.params.type}] ${text}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    console.log(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === "Log.entryAdded") {
    console.log(`[log:${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
  }
};
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

if (cmd === "eval") {
  const res = await send("Runtime.evaluate", { expression: args.join(" "), awaitPromise: true, returnByValue: true });
  if (res.result.exceptionDetails) console.error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
  else console.log(typeof res.result.result.value === "string" ? res.result.result.value : JSON.stringify(res.result.result.value, null, 2));
  ws.close();
} else if (cmd === "heap") {
  const res = await send("Runtime.evaluate", { expression: "JSON.stringify(performance.memory ? {usedJSHeapMB: +(performance.memory.usedJSHeapSize/1048576).toFixed(1), totalJSHeapMB: +(performance.memory.totalJSHeapSize/1048576).toFixed(1)} : null)", returnByValue: true });
  console.log(res.result.result.value);
  ws.close();
} else if (cmd === "logs") {
  await send("Runtime.enable"); await send("Log.enable");
  console.error(`streaming console of ${target.url} (Ctrl-C to stop)`);
} else { console.error("unknown cmd"); process.exit(1); }
