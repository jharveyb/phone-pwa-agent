/// <reference lib="webworker" />
// Nested worker owned by the agent worker: Pyodide (CPython in WASM) as a sandbox for the `python` tool.
// Files under the agent's home are copied in before each run and copied back afterwards.
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
type FileMap = Record<string, string>; // path -> base64
interface RunReq { type: "run"; id: number; code: string; files: FileMap; home: string }
interface RunRes { type: "result"; id: number; stdout: string; stderr: string; error?: string; files: FileMap; ms: number; loadMs?: number }

let pyodidePromise: Promise<any> | undefined;
let loadMs: number | undefined;
function loadPy() {
  return (pyodidePromise ??= (async () => {
    const t0 = performance.now();
    const mod = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
    const py = await mod.loadPyodide({ indexURL: PYODIDE_URL });
    loadMs = Math.round(performance.now() - t0);
    self.postMessage({ type: "log", text: `pyodide ${py.version} loaded in ${loadMs}ms` });
    return py;
  })());
}
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

self.onmessage = async (ev: MessageEvent<RunReq>) => {
  const m = ev.data; if (m.type !== "run") return;
  const t0 = performance.now();
  let stdout = "", stderr = "", error: string | undefined;
  const files: FileMap = {};
  try {
    const py = await loadPy();
    const FS = py.FS;
    // sync in
    for (const [p, data] of Object.entries(m.files)) {
      const dir = p.slice(0, p.lastIndexOf("/")) || "/";
      try { FS.mkdirTree(dir); } catch {}
      FS.writeFile(p, b64d(data));
    }
    try { FS.mkdirTree(m.home); } catch {}
    FS.chdir(m.home);
    py.setStdout({ batched: (s: string) => { stdout += s + "\n"; } });
    py.setStderr({ batched: (s: string) => { stderr += s + "\n"; } });
    try {
      const r = await py.runPythonAsync(m.code);
      if (r !== undefined && r !== null) { const s = String(r); if (s && s !== "None") stdout += s + "\n"; }
    } catch (e) { error = String((e as Error).message ?? e); }
    // sync out: everything under home
    const walk = (dir: string) => { for (const n of FS.readdir(dir)) { if (n === "." || n === "..") continue; const p = `${dir}/${n}`; const st = FS.stat(p); if (FS.isDir(st.mode)) walk(p); else if (FS.isFile(st.mode) && st.size < 2_000_000) files[p] = b64e(FS.readFile(p)); } };
    walk(m.home);
  } catch (e) { error = `pyodide failed: ${(e as Error).message ?? e}`; }
  const res: RunRes = { type: "result", id: m.id, stdout, stderr, error, files, ms: Math.round(performance.now() - t0), loadMs };
  self.postMessage(res);
};
