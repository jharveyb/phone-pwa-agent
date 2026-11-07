/// <reference lib="webworker" />
// tailscale-web node in a dedicated worker: joins the tailnet with an auth key and serves HTTP on a tailnet port.
// Requests are parsed here and routed to the main thread (see control-protocol.ts); responses come back the same way.
import type { Connection } from "tailscale-web";
import type { MainToTs, TsToMain } from "./control-protocol";
import { buildResponse, RequestParser, sseFrame, sseHead } from "./http";
import { openTsStorage } from "./ts-storage";

const post = (m: TsToMain) => self.postMessage(m);
const log = (s: string) => post({ type: "log", text: `[ts] ${s}` });

const conns = new Map<number, { conn: Connection; sse: boolean }>();
let nextId = 0;
let net: typeof import("tailscale-web").network | undefined;
let exitNodeWanted: string | null = null;
let exitNodeActive: string | null = null;

async function ensureExitNode(): Promise<string | null> {
  if (!net || !exitNodeWanted) return null;
  if (exitNodeActive === exitNodeWanted) return exitNodeActive;
  const nodes = net.listExitNodes();
  const n = nodes.find((x) => x.hostName === exitNodeWanted || x.dnsName.startsWith(exitNodeWanted + ".") || x.tailscaleIP === exitNodeWanted);
  if (!n) { log(`exit node "${exitNodeWanted}" not found; available: ${nodes.map((x) => x.hostName + (x.online ? "" : "(offline)")).join(", ") || "none"}`); return null; }
  await net.setExitNode(n.id);
  exitNodeActive = exitNodeWanted;
  log(`exit node set: ${n.hostName} (${n.tailscaleIP}) online=${n.online}`);
  return exitNodeActive;
}

async function doFetch(m: Extract<MainToTs, { type: "fetch" }>) {
  try {
    if (!net) throw new Error("tailscale not initialized");
    const via = await ensureExitNode();
    const t0 = performance.now();
    const r = await net.fetch(m.url, { method: m.init?.method ?? "GET", headers: { "user-agent": "phone-agent/0.1 (+tailscale-web)", ...(m.init?.headers ?? {}) }, ...(m.init?.body !== undefined ? { body: m.init.body } : {}) });
    const bytes = await r.bytes();
    const max = m.maxBytes ?? 512 * 1024;
    const body = new TextDecoder().decode(bytes.subarray(0, max)) + (bytes.length > max ? `\n[truncated ${bytes.length - max} bytes]` : "");
    log(`fetch ${m.url} -> ${r.status} ${bytes.length}B ${(performance.now() - t0).toFixed(0)}ms${via ? " via " + via : ""}`);
    post({ type: "fetch-result", id: m.id, ok: true, status: r.status, headers: r.headers, body, viaExitNode: via ?? undefined });
  } catch (e) {
    log(`fetch ${m.url} FAILED: ${e}`);
    post({ type: "fetch-result", id: m.id, ok: false, error: String(e) });
  }
}

self.onmessage = async (ev: MessageEvent<MainToTs>) => {
  const m = ev.data;
  if (m.type === "init") return init(m).catch((e) => { log(`ERROR ${(e as Error).stack ?? e}`); post({ type: "error", text: String(e) }); });
  if (m.type === "fetch") return doFetch(m);
  const c = conns.get(m.id);
  if (!c) return;
  try {
    if (m.type === "response") { c.conn.write(buildResponse(m.status, m.body, m.headers)); closeSoon(m.id); }
    else if (m.type === "sse-open") { c.sse = true; c.conn.write(sseHead()); }
    else if (m.type === "sse-event") c.conn.write(sseFrame(m.event, m.data));
    else if (m.type === "close") closeSoon(m.id);
  } catch (e) { log(`conn#${m.id} write failed: ${e}`); conns.delete(m.id); }
};

function closeSoon(id: number) {
  const c = conns.get(id); if (!c) return;
  conns.delete(id);
  setTimeout(() => { try { c.conn.close(); } catch {} }, 100); // let the last write flush
}

async function init(m: Extract<MainToTs, { type: "init" }>) {
  const t0 = performance.now();
  const { network } = await import("tailscale-web");
  net = network; exitNodeWanted = m.exitNode ?? null;
  log(`module loaded in ${(performance.now() - t0).toFixed(0)}ms`);
  const storage = await openTsStorage();
  log(`persisted state keys: ${storage.keys().length}`);
  const t1 = performance.now();
  await network.init({
    hostname: m.hostname,
    storage,
    ...(m.authKey ? { authKey: m.authKey } : {}),
    onAuthRequired: (url: string) => { log(`AUTH REQUIRED (no/invalid auth key): ${url}`); post({ type: "authRequired", url }); },
    onAuthComplete: () => log("auth complete"),
  });
  const ip4 = network.localIPv4(), ip6 = network.localIPv6();
  log(`init done in ${(performance.now() - t1).toFixed(0)}ms; ip4=${ip4} ip6=${ip6}`);
  post({ type: "ready", ip4, ip6, initMs: performance.now() - t1 });

  const listener = await network.listenTCP(m.port, (conn) => {
    const id = ++nextId;
    const parser = new RequestParser();
    conns.set(id, { conn, sse: false });
    let done = false;
    conn.onData((data) => {
      if (done) return;
      try {
        const req = parser.push(data);
        if (!req) return;
        done = true;
        post({ type: "http", id, req });
      } catch (e) {
        conn.write(buildResponse(400, `bad request: ${e}\n`)); closeSoon(id);
      }
    });
  });
  log(`listening on tailnet port ${listener.port}`);
  post({ type: "listening", port: listener.port });
}
