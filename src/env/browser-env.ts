// BrowserExecutionEnv: the agent's "machine" inside the browser tab.
// Shell = just-bash (TypeScript bash interpreter, no binaries); filesystem = just-bash InMemoryFs,
// snapshot()/restore() serialize the whole tree so the worker can persist it to OPFS.
import { Bash, InMemoryFs } from "just-bash/browser";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  wallMs: number;
}

export interface BrowserEnvOptions {
  cwd?: string;
  files?: Record<string, string>;
  env?: Record<string, string>;
  /** Default per-command wall-clock limit (ms). */
  defaultTimeoutMs?: number;
}

interface SnapshotEntry {
  path: string;
  type: "file" | "dir" | "symlink";
  data?: string; // base64 for files
  target?: string; // for symlinks
  mode: number;
  mtime: number;
}
export interface FsSnapshot {
  version: 1;
  cwd: string;
  savedAt: number;
  entries: SnapshotEntry[];
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class BrowserExecutionEnv {
  readonly fs: InMemoryFs;
  readonly bash: Bash;
  readonly cwd: string;
  readonly defaultTimeoutMs: number;

  constructor(opts: BrowserEnvOptions = {}, fs?: InMemoryFs) {
    this.cwd = opts.cwd ?? "/home/agent";
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;
    this.fs = fs ?? new InMemoryFs(opts.files ?? {});
    try { this.fs.mkdirSync(this.cwd, { recursive: true }); } catch { /* exists */ }
    this.bash = new Bash({
      fs: this.fs,
      cwd: this.cwd,
      env: { HOME: this.cwd, USER: "agent", TERM: "dumb", ...(opts.env ?? {}) },
      executionLimits: { maxExecutionTimeMs: this.defaultTimeoutMs },
    });
  }

  /** Resolve a possibly-relative path against cwd. */
  resolve(p: string): string {
    return this.fs.resolvePath(this.cwd, p);
  }

  async exec(command: string, opts: { signal?: AbortSignal; timeoutMs?: number; cwd?: string } = {}): Promise<ExecResult> {
    const ac = new AbortController();
    let timedOut = false;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => { timedOut = true; ac.abort(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
    const onAbort = () => ac.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const t0 = Date.now();
    try {
      const cmd = opts.cwd ? `cd ${JSON.stringify(opts.cwd)} && ${command}` : command;
      const r = await this.bash.exec(cmd, { signal: ac.signal });
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut, wallMs: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  // ---- fs helpers used by the tools ----
  async readFile(p: string): Promise<string> { return this.fs.readFile(this.resolve(p), "utf-8"); }
  async writeFile(p: string, content: string): Promise<void> {
    const abs = this.resolve(p);
    const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
    await this.fs.mkdir(dir, { recursive: true });
    await this.fs.writeFile(abs, content, "utf-8");
  }
  async exists(p: string): Promise<boolean> { return this.fs.exists(this.resolve(p)); }
  async stat(p: string) { return this.fs.stat(this.resolve(p)); }
  async readdir(p: string): Promise<string[]> { return this.fs.readdir(this.resolve(p)); }

  // ---- persistence ----
  async snapshot(): Promise<FsSnapshot> {
    const entries: SnapshotEntry[] = [];
    for (const path of this.fs.getAllPaths().sort()) {
      if (path === "/") continue;
      const st = await this.fs.lstat(path);
      const base = { path, mode: st.mode, mtime: st.mtime.getTime() };
      if (st.isSymbolicLink) entries.push({ ...base, type: "symlink", target: await this.fs.readlink(path) });
      else if (st.isDirectory) entries.push({ ...base, type: "dir" });
      else entries.push({ ...base, type: "file", data: b64encode(await this.fs.readFileBuffer(path)) });
    }
    return { version: 1, cwd: this.cwd, savedAt: Date.now(), entries };
  }

  static async restore(snap: FsSnapshot, opts: BrowserEnvOptions = {}): Promise<BrowserExecutionEnv> {
    const fs = new InMemoryFs();
    for (const e of snap.entries) {
      if (e.type === "dir") await fs.mkdir(e.path, { recursive: true });
    }
    for (const e of snap.entries) {
      if (e.type === "file") fs.writeFileSync(e.path, b64decode(e.data ?? ""), undefined, { mode: e.mode, mtime: new Date(e.mtime) });
      else if (e.type === "symlink") await fs.symlink(e.target ?? "", e.path);
    }
    return new BrowserExecutionEnv({ ...opts, cwd: opts.cwd ?? snap.cwd }, fs);
  }
}
