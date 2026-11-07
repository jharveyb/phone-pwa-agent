// The five stock pi tools (read/write/edit/bash/ls), re-implemented against BrowserExecutionEnv.
// Schemas and descriptions mirror @earendil-works/pi-coding-agent 1.5.0 so the model behaves the same.
// (pi's own tool modules import node:fs / child_process / pi-tui at module level and can't run in a browser.)
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { BrowserExecutionEnv } from "../env/browser-env";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

const text = (t: string, details: unknown = undefined, extra: Partial<AgentToolResult> = {}): AgentToolResult<any> => ({
  content: [{ type: "text", text: t }],
  details,
  ...extra,
});

function truncateHead(s: string) {
  const lines = s.split("\n");
  let out = lines.slice(0, DEFAULT_MAX_LINES).join("\n");
  let truncated = lines.length > DEFAULT_MAX_LINES;
  if (new TextEncoder().encode(out).length > DEFAULT_MAX_BYTES) {
    out = new TextDecoder().decode(new TextEncoder().encode(out).subarray(0, DEFAULT_MAX_BYTES));
    truncated = true;
  }
  return { out, truncated, totalLines: lines.length };
}
function truncateTail(s: string) {
  const lines = s.split("\n");
  let out = lines.slice(-DEFAULT_MAX_LINES).join("\n");
  let truncated = lines.length > DEFAULT_MAX_LINES;
  const bytes = new TextEncoder().encode(out);
  if (bytes.length > DEFAULT_MAX_BYTES) {
    out = new TextDecoder().decode(bytes.subarray(bytes.length - DEFAULT_MAX_BYTES));
    truncated = true;
  }
  return { out, truncated, totalLines: lines.length };
}

export function createReadTool(env: BrowserExecutionEnv): AgentTool<any> {
  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read (relative or absolute)" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    async execute(_id, { path, offset, limit }: { path: string; offset?: number; limit?: number }) {
      const abs = env.resolve(path);
      if (!(await env.exists(abs))) throw new Error(`File not found: ${abs}`);
      if ((await env.stat(abs)).isDirectory) throw new Error(`Path is a directory: ${abs}`);
      const content = await env.readFile(abs);
      let lines = content.split("\n");
      const total = lines.length;
      const start = Math.max(0, (offset ?? 1) - 1);
      if (start >= total && total > 0) throw new Error(`Offset ${offset} is beyond end of file (${total} lines)`);
      lines = lines.slice(start, limit ? start + limit : undefined);
      const { out, truncated } = truncateHead(lines.join("\n"));
      let note = "";
      if (truncated) note = `\n\n[Output truncated. Use offset=${start + out.split("\n").length} to continue; file has ${total} lines]`;
      else if (limit && start + limit < total) note = `\n\n[Showing lines ${start + 1}-${start + lines.length} of ${total}. Use offset=${start + lines.length + 1} to continue]`;
      return text(out + note, { truncated, totalLines: total });
    },
  };
}

export function createWriteTool(env: BrowserExecutionEnv): AgentTool<any> {
  return {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write (relative or absolute)" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
    async execute(_id, { path, content }: { path: string; content: string }) {
      await env.writeFile(path, content);
      return text(`Successfully wrote ${new TextEncoder().encode(content).length} bytes to ${env.resolve(path)}`);
    },
  };
}

export function createEditTool(env: BrowserExecutionEnv): AgentTool<any> {
  return {
    name: "edit",
    label: "edit",
    description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
        edits: {
          type: "array",
          description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string", description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call." },
              newText: { type: "string", description: "Replacement text for this targeted edit." },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
    // Accept the older single {oldText,newText} shape too.
    prepareArguments(args: any) {
      if (args && !args.edits && typeof args.oldText === "string") return { path: args.path, edits: [{ oldText: args.oldText, newText: args.newText ?? "" }] };
      return args;
    },
    async execute(_id, { path, edits }: { path: string; edits: { oldText: string; newText: string }[] }) {
      const abs = env.resolve(path);
      if (!(await env.exists(abs))) throw new Error(`File not found: ${abs}`);
      const original = await env.readFile(abs);
      if (!edits?.length) throw new Error("No edits provided");
      // locate every edit against the ORIGINAL, verify uniqueness + non-overlap, then apply right-to-left
      const spans = edits.map((e, i) => {
        if (!e.oldText) throw new Error(`edits[${i}].oldText is empty`);
        const first = original.indexOf(e.oldText);
        if (first < 0) throw new Error(`edits[${i}]: could not find the exact text in ${abs}. Make sure whitespace and indentation match exactly.`);
        if (original.indexOf(e.oldText, first + 1) >= 0) throw new Error(`edits[${i}]: text matches multiple locations in ${abs}; include more context to make it unique.`);
        return { start: first, end: first + e.oldText.length, newText: e.newText, i };
      }).sort((a, b) => a.start - b.start);
      for (let k = 1; k < spans.length; k++) if (spans[k].start < spans[k - 1].end) throw new Error(`edits[${spans[k].i}] overlaps edits[${spans[k - 1].i}]; merge them into one edit.`);
      let out = original;
      for (const s of [...spans].reverse()) out = out.slice(0, s.start) + s.newText + out.slice(s.end);
      if (out === original) throw new Error("Edits produced no change (newText equals oldText?)");
      await env.writeFile(abs, out);
      return text(`Successfully applied ${edits.length} edit${edits.length === 1 ? "" : "s"} to ${abs}`);
    },
  };
}

export function createBashTool(env: BrowserExecutionEnv): AgentTool<any> {
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Optionally provide a timeout in seconds. This shell is an in-browser bash interpreter: coreutils, grep/sed/awk, jq, find, curl-less; no external binaries, no network.`,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
      },
      required: ["command"],
    },
    executionMode: "sequential",
    async execute(_id, { command, timeout }: { command: string; timeout?: number }, signal) {
      const r = await env.exec(command, { signal, timeoutMs: timeout ? timeout * 1000 : undefined });
      let combined = r.stdout + (r.stderr ? (r.stdout && !r.stdout.endsWith("\n") ? "\n" : "") + r.stderr : "");
      const { out, truncated } = truncateTail(combined.replace(/\n$/, ""));
      let body = out;
      if (truncated) body = `[Output truncated to last ${DEFAULT_MAX_LINES} lines / ${DEFAULT_MAX_BYTES / 1024}KB]\n` + body;
      if (r.timedOut) body += `\n\nCommand timed out after ${timeout ?? env.defaultTimeoutMs / 1000} seconds`;
      else if (r.exitCode !== 0) body += `\n\nCommand exited with code ${r.exitCode}`;
      const isError = r.timedOut || r.exitCode !== 0;
      return text(body || "(no output)", { exitCode: r.exitCode, timedOut: r.timedOut, wallMs: r.wallMs, truncated }, { isError });
    },
  };
}

export function createLsTool(env: BrowserExecutionEnv): AgentTool<any> {
  const DEFAULT_LIMIT = 500;
  return {
    name: "ls",
    label: "ls",
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list (default: current directory)" },
        limit: { type: "number", description: "Maximum number of entries to return (default: 500)" },
      },
    },
    async execute(_id, { path, limit }: { path?: string; limit?: number }) {
      const abs = env.resolve(path ?? ".");
      if (!(await env.exists(abs))) throw new Error(`Path not found: ${abs}`);
      if (!(await env.stat(abs)).isDirectory) throw new Error(`Path is not a directory: ${abs}`);
      const names = (await env.readdir(abs)).sort();
      const max = limit ?? DEFAULT_LIMIT;
      const shown = names.slice(0, max);
      const lines: string[] = [];
      for (const n of shown) {
        const st = await env.fs.lstat(abs === "/" ? `/${n}` : `${abs}/${n}`);
        lines.push(st.isDirectory ? `${n}/` : n);
      }
      const { out, truncated } = truncateHead(lines.join("\n"));
      let body = out || "(empty directory)";
      if (names.length > max) body += `\n\n[${names.length - max} more entries not shown; use limit to see more]`;
      return text(body, { truncated, entryLimitReached: names.length > max ? max : undefined });
    },
  };
}

export function createBrowserTools(env: BrowserExecutionEnv): AgentTool<any>[] {
  return [createReadTool(env), createWriteTool(env), createEditTool(env), createBashTool(env), createLsTool(env)];
}
