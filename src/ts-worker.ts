/// <reference lib="webworker" />
// Spike A: tailscale-web node in a dedicated worker, listening on :8080 for inbound tailnet TCP.
import { openTsStorage } from "./ts-storage";

type Msg = { type: "init"; authKey: string | null; hostname: string; port: number };
const post = (m: Record<string, unknown>) => self.postMessage(m);
const log = (s: string) => post({ type: "log", text: `[ts] ${s}` });

function httpResponse(status: number, body: string, extra = ""): string {
  const bytes = new TextEncoder().encode(body).length;
  return `HTTP/1.1 ${status} ${status === 200 ? "OK" : "Error"}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${bytes}\r\nConnection: close\r\n${extra}\r\n${body}`;
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type !== "init") return;
  try {
    const t0 = performance.now();
    const { network } = await import("tailscale-web");
    log(`module loaded in ${(performance.now() - t0).toFixed(0)}ms`);
    const storage = await openTsStorage();
    log(`persisted state keys: ${storage.keys().length}`);
    const t1 = performance.now();
    // NOTE: `authKey` is not in tailscale-web's InitOptions typings; the options object is passed straight to the
    // Go side (tsconnect-derived), which may honour it. If onAuthRequired fires, it doesn't.
    await network.init({
      hostname: m.hostname,
      storage,
      ...(m.authKey ? { authKey: m.authKey } : {}),
      onAuthRequired: (url: string) => {
        log(`AUTH REQUIRED (auth key not honoured?) login url: ${url}`);
        post({ type: "authRequired", url });
      },
      onAuthComplete: () => log("auth complete"),
    } as any);
    const initMs = performance.now() - t1;
    const ip4 = network.localIPv4();
    log(`init done in ${initMs.toFixed(0)}ms; ip4=${ip4} ip6=${network.localIPv6()}`);
    post({ type: "ready", ip4, ip6: network.localIPv6(), initMs });

    let conns = 0;
    const listener = await network.listenTCP(m.port, (conn) => {
      const id = ++conns;
      let buf = "";
      conn.onData((data) => {
        buf += new TextDecoder().decode(data);
        if (buf.includes("\r\n\r\n")) {
          const reqLine = buf.split("\r\n")[0];
          log(`conn#${id}: ${reqLine}`);
          conn.write(httpResponse(200, `hello from the phone tab\nnode=${ip4}\nreq=${reqLine}\nt=${new Date().toISOString()}\n`));
          setTimeout(() => conn.close(), 50);
        }
      });
    });
    log(`listening on tailnet port ${listener.port}`);
    post({ type: "listening", port: listener.port });
    setInterval(() => post({ type: "tsStatus", text: network.status(true) }), 30_000);
  } catch (e) {
    log(`ERROR ${(e as Error).stack ?? e}`);
    post({ type: "error", text: String(e) });
  }
};
