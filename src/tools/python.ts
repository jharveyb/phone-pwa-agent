// `python` tool: runs code in Pyodide (CPython/WASM) inside a nested worker. The agent's home directory is mirrored
// into the sandbox before the run and changed files are copied back into the BrowserExecutionEnv afterwards.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { BrowserExecutionEnv } from "../env/browser-env";

const b64e = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createPythonTool(env: BrowserExecutionEnv, log: (s: string) => void): AgentTool<any> {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<number, (r: any) => void>();
  const getWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL("../py-worker.ts", import.meta.url), { type: "module", name: "python" });
    worker.onmessage = (ev) => { const m = ev.data; if (m.type === "log") log(`[python] ${m.text}`); else if (m.type === "result") { pending.get(m.id)?.(m); pending.delete(m.id); } };
    worker.onerror = (e) => { log(`[python] worker error: ${e.message}`); for (const r of pending.values()) r({ error: `python worker crashed: ${e.message}`, stdout: "", stderr: "", files: {}, ms: 0 }); pending.clear(); worker?.terminate(); worker = undefined; };
    return worker;
  };
  return {
    name: "python",
    label: "python",
    description: "Run Python 3 code in a sandbox (CPython via Pyodide, no network, no pip). The working directory is the agent's home: files there are visible to the script and files it writes are kept. Captures stdout/stderr; the value of the last expression is printed. First call loads the runtime (~15 MB, cached afterwards).",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "Python source to execute" }, timeout: { type: "number", description: "Timeout in seconds (default 120)" } },
      required: ["code"],
    },
    executionMode: "sequential",
    async execute(_id, { code, timeout }: { code: string; timeout?: number }, signal) {
      // mirror home into the sandbox
      const files: Record<string, string> = {};
      for (const p of env.fs.getAllPaths()) {
        if (!p.startsWith(env.cwd + "/")) continue;
        const st = await env.fs.lstat(p);
        if (st.isFile && st.size < 2_000_000) files[p] = b64e(await env.fs.readFileBuffer(p));
      }
      const id = ++nextId;
      const w = getWorker();
      const res: any = await new Promise((resolve) => {
        const t = setTimeout(() => { pending.delete(id); w.terminate(); worker = undefined; resolve({ error: `python timed out after ${timeout ?? 120}s (runtime restarted)`, stdout: "", stderr: "", files: {}, ms: 0 }); }, (timeout ?? 120) * 1000);
        signal?.addEventListener("abort", () => { clearTimeout(t); pending.delete(id); resolve({ error: "aborted", stdout: "", stderr: "", files: {}, ms: 0 }); }, { once: true });
        pending.set(id, (r) => { clearTimeout(t); resolve(r); });
        w.postMessage({ type: "run", id, code, files, home: env.cwd });
      });
      // copy back changed/new files
      let changed = 0;
      for (const [p, data] of Object.entries(res.files ?? {})) {
        if (files[p] === data) continue;
        const dir = p.slice(0, p.lastIndexOf("/")) || "/";
        await env.fs.mkdir(dir, { recursive: true });
        await env.fs.writeFile(p, b64d(data as string));
        changed++;
      }
      let out = (res.stdout ?? "") + (res.stderr ? (res.stdout ? "\n" : "") + "[stderr]\n" + res.stderr : "");
      if (res.error) out += (out ? "\n" : "") + `[error]\n${res.error}`;
      if (out.length > 50_000) out = out.slice(0, 50_000) + "\n[truncated]";
      const meta = `[python: ${res.ms}ms${res.loadMs ? `, runtime load ${res.loadMs}ms` : ""}${changed ? `, ${changed} file(s) updated` : ""}]`;
      return { content: [{ type: "text", text: (out || "(no output)") + "\n" + meta }], details: { ms: res.ms, changed, error: res.error }, isError: !!res.error };
    },
  };
}
