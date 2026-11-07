// Main thread: minimal status page + router between the tailscale worker (HTTP on the tailnet) and the agent worker.
import type { AgentPublicState, AgentWorkerIn, AgentWorkerOut } from "./agent-worker";
import { loadConfig, type AppConfig } from "./config";
import type { MainToTs, TsToMain } from "./control-protocol";
import type { HttpRequest } from "./http";

const BOOT = Date.now();
const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const logLines: string[] = [];
function line(s: string) {
  const l = `[${new Date().toISOString().slice(11, 19)}] ${s}`;
  logLines.push(l); if (logLines.length > 500) logLines.shift();
  logEl.textContent = logLines.slice(-60).join("\n");
  console.log(s);
}

// ---------- agent worker host (restartable) ----------
type EventRec = { seq: number; t: number; event: any };
class AgentHost {
  worker!: Worker;
  ready = false;
  state: AgentPublicState | null = null;
  events: EventRec[] = [];
  seq = 0;
  restarts = 0;
  private subs = new Set<(e: EventRec) => void>();
  constructor(private cfg: AppConfig) { this.spawn(); }
  private spawn() {
    this.ready = false;
    this.worker = new Worker(new URL("./agent-worker.ts", import.meta.url), { type: "module", name: "agent" });
    this.worker.onmessage = (ev: MessageEvent<AgentWorkerOut>) => {
      const m = ev.data;
      if (m.type === "log") line(m.text);
      else if (m.type === "ready") this.ready = true;
      else if (m.type === "state") this.state = m.state;
      else if (m.type === "error") { line(`[agent] ERROR ${m.text}`); this.emit({ type: "error", text: m.text }); }
      else if (m.type === "event") this.emit(m.event);
    };
    this.worker.onerror = (e) => line(`agent worker error: ${e.message}`);
    if (this.cfg.tinfoilApiKey && this.cfg.tinfoilModel) this.send({ type: "init", tinfoilApiKey: this.cfg.tinfoilApiKey, model: this.cfg.tinfoilModel });
    else line("agent: no TINFOIL_API_KEY/TINFOIL_MODEL in config, agent idle");
  }
  private emit(event: any) {
    const rec = { seq: ++this.seq, t: Date.now(), event };
    this.events.push(rec); if (this.events.length > 300) this.events.shift();
    if (event.type === "tool_execution_start") line(`[agent] tool ${event.toolName} ${JSON.stringify(event.args).slice(0, 120)}`);
    else if (event.type === "tool_execution_end") line(`[agent] tool ${event.toolName} done isError=${event.isError} ${event.durationMs ?? "?"}ms`);
    else if (event.type === "turn_end" && event.message?.role === "assistant") {
      const t = (event.message.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join("");
      if (t) line(`[agent] assistant: ${t.slice(0, 300)}`);
      line(`[agent] usage in=${event.message.usage?.input} out=${event.message.usage?.output} stop=${event.message.stopReason}`);
    } else if (event.type === "agent_end") line(`[agent] agent_end (${event.messages?.length} new messages)`);
    for (const s of this.subs) s(rec);
  }
  send(m: AgentWorkerIn) { this.worker.postMessage(m); }
  subscribe(fn: (e: EventRec) => void) { this.subs.add(fn); return () => this.subs.delete(fn); }
  restart() { line("[agent] restarting worker"); this.worker.terminate(); this.restarts++; this.state = null; this.spawn(); }
}

// ---------- router ----------
interface Ctx { cfg: AppConfig; agent: AgentHost; ts: { ip4: string; ip6: string; initMs: number; listening: boolean; errors: string[]; authUrl?: string } }
type Reply = { status: number; body: string; headers?: Record<string, string> } | { sse: (write: (event: string, data: unknown) => void, onClose: (fn: () => void) => void) => void };

function fullState(ctx: Ctx) {
  return {
    heartbeat: new Date().toISOString(),
    uptimeS: Math.round((Date.now() - BOOT) / 1000),
    visibility: document.visibilityState,
    wakeLock: wakeLockHeld,
    webLock: webLockHeld,
    online: navigator.onLine,
    ts: ctx.ts,
    agent: { ready: ctx.agent.ready, restarts: ctx.agent.restarts, eventSeq: ctx.agent.seq, ...(ctx.agent.state ?? {}) },
    memory: (performance as any).memory ? { usedJSHeapMB: +((performance as any).memory.usedJSHeapSize / 1048576).toFixed(1) } : undefined,
  };
}

async function route(req: HttpRequest, ctx: Ctx): Promise<Reply> {
  const jsonBody = () => { try { return req.body ? JSON.parse(req.body) : {}; } catch { throw new Error("body is not JSON"); } };
  if (req.method === "GET" && req.path === "/") return { status: 200, body: `phone-agent ${ctx.ts.ip4} up ${Math.round((Date.now() - BOOT) / 1000)}s agent=${ctx.agent.ready ? "ready" : "init"} streaming=${ctx.agent.state?.isStreaming ?? "?"}\nendpoints: GET /state, POST /prompt {text}, POST /steer {text}, POST /abort, POST /restart, POST /session/clear, GET /events[?since=N], GET /log\n` };
  if (req.method === "GET" && req.path === "/state") return { status: 200, body: JSON.stringify(fullState(ctx), null, 1) + "\n", headers: { "content-type": "application/json" } };
  if (req.method === "GET" && req.path === "/log") return { status: 200, body: logLines.join("\n") + "\n" };
  if (req.method === "POST" && (req.path === "/prompt" || req.path === "/steer")) {
    // JSON {text} or a raw text/plain body; a JSON body without a string "text" is rejected
    const isJson = (req.headers["content-type"] ?? "").includes("json") || req.body.trim().startsWith("{");
    const text = isJson ? jsonBody().text : req.body;
    if (typeof text !== "string") return { status: 400, body: "expected JSON {\"text\": string}\n" };
    if (!text?.trim()) return { status: 400, body: "missing text\n" };
    if (!ctx.agent.ready) return { status: 503, body: "agent not ready\n" };
    ctx.agent.send({ type: req.path === "/prompt" ? "prompt" : "steer", text });
    return { status: 202, body: JSON.stringify({ accepted: true, seq: ctx.agent.seq }) + "\n", headers: { "content-type": "application/json" } };
  }
  if (req.method === "POST" && req.path === "/abort") { ctx.agent.send({ type: "abort" }); return { status: 202, body: "abort requested\n" }; }
  if (req.method === "POST" && req.path === "/session/clear") { ctx.agent.send({ type: "clear-session" }); return { status: 202, body: "session cleared\n" }; }
  if (req.method === "POST" && req.path === "/restart") { ctx.agent.restart(); return { status: 202, body: "agent worker restarted\n" }; }
  if (req.method === "GET" && req.path === "/events") {
    const since = parseInt(req.query.since ?? "", 10);
    return {
      sse: (write, onClose) => {
        write("hello", { seq: ctx.agent.seq, state: fullState(ctx) });
        for (const r of ctx.agent.events) if (!Number.isNaN(since) && r.seq > since) write(r.event.type, { seq: r.seq, t: r.t, ...r.event });
        const unsub = ctx.agent.subscribe((r) => write(r.event.type, { seq: r.seq, t: r.t, ...r.event }));
        const hb = setInterval(() => write("heartbeat", { t: Date.now(), streaming: ctx.agent.state?.isStreaming }), 15_000);
        onClose(() => { unsub(); clearInterval(hb); });
      },
    };
  }
  return { status: 404, body: `no route ${req.method} ${req.path}\n` };
}

// ---------- keep-alive (step 7, minimal for now) ----------
let wakeLock: WakeLockSentinel | null = null;
let wakeLockHeld = false;
async function acquireWakeLock() {
  try { wakeLock = await navigator.wakeLock.request("screen"); wakeLockHeld = true; wakeLock.addEventListener("release", () => { wakeLockHeld = false; }); line("wake lock acquired"); }
  catch (e) { wakeLockHeld = false; line(`wake lock failed: ${e}`); }
}
document.addEventListener("visibilitychange", () => { line(`visibility: ${document.visibilityState}`); if (document.visibilityState === "visible") acquireWakeLock(); });

// ---------- keep-alive extras ----------
let webLockHeld = false;
function holdWebLock() {
  if (!("locks" in navigator)) return;
  // Held for the page lifetime; Chrome treats a page holding a lock as doing work (and other tabs can detect us).
  navigator.locks.request("phone-agent-main", { mode: "exclusive" }, () => { webLockHeld = true; return new Promise<void>(() => {}); }).catch((e) => line(`web lock: ${e}`));
}
async function setupPersistence() {
  try { const p = await navigator.storage.persist(); line(`storage.persist() => ${p}`); } catch (e) { line(`storage.persist failed: ${e}`); }
  if ("serviceWorker" in navigator) {
    try { const r = await navigator.serviceWorker.register("/sw.js", { type: "module" }); line(`service worker registered (scope ${r.scope})`); }
    catch (e) { line(`service worker failed: ${e}`); }
  }
}

// ---------- boot ----------
async function main() {
  line(`boot; secureContext=${window.isSecureContext} OPFS=${!!navigator.storage?.getDirectory} wakeLock=${"wakeLock" in navigator}`);
  const params = new URLSearchParams(location.search);
  if (params.get("reset") === "ts") {
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase("phone-agent"); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    line("tailscale state wiped (?reset=ts) — this registers a NEW node on the tailnet");
  }
  const cfg = await loadConfig();
  line(`config: tsAuthKey=${cfg.tsAuthKey ? "set" : "MISSING"} tinfoilApiKey=${cfg.tinfoilApiKey ? "set" : "MISSING"} model=${cfg.tinfoilModel} hostname=${cfg.tsHostname}`);
  const ctx: Ctx = { cfg, agent: new AgentHost(cfg), ts: { ip4: "", ip6: "", initMs: 0, listening: false, errors: [] } };
  (window as any).__pa = { ctx, prompt: (text: string) => ctx.agent.send({ type: "prompt", text }), abort: () => ctx.agent.send({ type: "abort" }), log: logLines, state: () => fullState(ctx) };

  const ts = new Worker(new URL("./ts-worker.ts", import.meta.url), { type: "module", name: "tailscale" });
  const sseClose = new Map<number, () => void>();
  ts.onmessage = async (ev: MessageEvent<TsToMain>) => {
    const m = ev.data;
    if (m.type === "log") line(m.text);
    else if (m.type === "ready") Object.assign(ctx.ts, { ip4: m.ip4, ip6: m.ip6, initMs: Math.round(m.initMs) });
    else if (m.type === "listening") ctx.ts.listening = true;
    else if (m.type === "authRequired") ctx.ts.authUrl = m.url;
    else if (m.type === "error") ctx.ts.errors.push(m.text);
    else if (m.type === "tsStatus") { /* noisy; available via console */ console.log(m.text); }
    else if (m.type === "closed") { sseClose.get(m.id)?.(); sseClose.delete(m.id); }
    else if (m.type === "http") {
      const send = (x: MainToTs) => ts.postMessage(x);
      try {
        const r = await route(m.req, ctx);
        if ("sse" in r) {
          send({ type: "sse-open", id: m.id });
          r.sse((event, data) => send({ type: "sse-event", id: m.id, event, data }), (fn) => sseClose.set(m.id, fn));
        } else send({ type: "response", id: m.id, status: r.status, body: r.body, headers: r.headers });
      } catch (e) { send({ type: "response", id: m.id, status: 500, body: `error: ${(e as Error).message}\n` }); }
    }
  };
  ts.onerror = (e) => line(`ts worker error: ${e.message}`);
  ts.postMessage({ type: "init", authKey: cfg.tsAuthKey, hostname: cfg.tsHostname, port: 8080 } satisfies MainToTs);
  await acquireWakeLock();
  holdWebLock();
  setupPersistence();
  setInterval(() => { statusEl.textContent = `up ${Math.round((Date.now() - BOOT) / 1000)}s · ts ${ctx.ts.ip4 || "…"} · agent ${ctx.agent.ready ? (ctx.agent.state?.isStreaming ? "busy" : "idle") : "init"} · ${new Date().toISOString().slice(11, 19)}`; }, 1000);
}
main().catch((e) => line(`main failed: ${e}`));
