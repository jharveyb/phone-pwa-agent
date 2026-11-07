#!/usr/bin/env node
// Minimal Chrome DevTools Protocol client for the phone's Chrome (via `adb forward`).
// Usage:
//   cdp.mjs targets                 list page/worker targets
//   cdp.mjs eval  [--url substr] <js-expression>   evaluate in the page (awaits promises)
//   cdp.mjs logs  [--url substr]    stream console + exceptions until Ctrl-C
//   cdp.mjs heap  [--url substr] [--type page|worker]   JS heap usage of a realm (Runtime.getHeapUsage)
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const cmd = args.shift();
let urlFilter = "ts.net", typeFilter = "page";
const i = args.indexOf("--url");
if (i >= 0) { urlFilter = args[i + 1]; args.splice(i, 2); }
const j = args.indexOf("--type");
if (j >= 0) { typeFilter = args[j + 1]; args.splice(j, 2); }

execSync("adb forward tcp:9222 localabstract:chrome_devtools_remote", { stdio: "ignore" });
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
if (cmd === "targets") {
  for (const t of targets) console.log(`${t.type}\t${t.id}\t${t.url}`);
  process.exit(0);
}
const target = targets.find((t) => t.type === typeFilter && t.url.includes(urlFilter));
if (!target) { console.error(`no page target matching ${urlFilter}`); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
let id = 0; const pending = new Map();
const sessionNames = new Map(); // sessionId -> label
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  const who = msg.sessionId ? `{${sessionNames.get(msg.sessionId) ?? "worker"}} ` : "";
  if (msg.method === "Target.attachedToTarget") {
    const { sessionId, targetInfo } = msg.params;
    const label = targetInfo.url.split("/").pop()?.split("?")[0] || targetInfo.type;
    sessionNames.set(sessionId, label);
    console.error(`attached to ${targetInfo.type} ${label}`);
    for (const method of ["Runtime.enable", "Log.enable"]) ws.send(JSON.stringify({ id: ++id, sessionId, method, params: {} }));
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    console.log(`${who}[${msg.params.type}] ${text}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    console.log(`${who}[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === "Log.entryAdded") {
    console.log(`${who}[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
};
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

if (cmd === "eval") {
  const res = await send("Runtime.evaluate", { expression: args.join(" "), awaitPromise: true, returnByValue: true });
  if (res.result.exceptionDetails) console.error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
  else console.log(typeof res.result.result.value === "string" ? res.result.result.value : JSON.stringify(res.result.result.value, null, 2));
  ws.close();
} else if (cmd === "heap") {
  const res = await send("Runtime.getHeapUsage");
  const r = res.result; console.log(JSON.stringify({ target: target.url, usedMB: +(r.usedSize/1048576).toFixed(1), totalMB: +(r.totalSize/1048576).toFixed(1) }));
  ws.close();
} else if (cmd === "logs") {
  await send("Runtime.enable"); await send("Log.enable");
  // dedicated workers aren't separate /json targets; auto-attach to them (flatten => same ws, sessionId-tagged)
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  console.error(`streaming console of ${target.url} + its workers (Ctrl-C to stop)`);
} else { console.error("unknown cmd"); process.exit(1); }
