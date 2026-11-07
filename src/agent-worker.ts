/// <reference lib="webworker" />
// The agent runtime: pi Agent + Tinfoil (OpenAI-compatible) + BrowserExecutionEnv tools, driven by postMessage.
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { BrowserExecutionEnv, type FsSnapshot } from "./env/browser-env";
import { opfsAppendText, opfsReadText, opfsRemove, opfsStat, opfsWriteText } from "./opfs";
import { createBrowserTools } from "./tools";

const FS_SNAPSHOT = "fs-snapshot.json";
const SESSION_LOG = "session.jsonl";
const SNAPSHOT_INTERVAL_MS = 30_000;

export type AgentWorkerIn =
  | { type: "init"; tinfoilApiKey: string; model: string; baseUrl?: string }
  | { type: "prompt"; text: string }
  | { type: "steer"; text: string }
  | { type: "abort" }
  | { type: "state" }
  | { type: "clear-session" };
export type AgentWorkerOut =
  | { type: "log"; text: string }
  | { type: "ready"; model: string }
  | { type: "event"; event: AgentEvent; t: number }
  | { type: "state"; state: AgentPublicState }
  | { type: "error"; text: string };
export interface AgentPublicState {
  model: string;
  isStreaming: boolean;
  messages: number;
  pendingToolCalls: string[];
  errorMessage?: string;
  lastAssistantText?: string;
  turns: number;
  persistence: { restoredMessages: number; restoredFiles: number; lastSnapshotAt?: number; snapshotBytes?: number; sessionBytes?: number; dirty: boolean };
}

const post = (m: AgentWorkerOut) => self.postMessage(m);
const log = (s: string) => post({ type: "log", text: `[agent] ${s}` });

const SYSTEM_PROMPT = `You are a coding agent running inside a browser tab on an Android phone. Your tools operate on an in-memory
Unix-like filesystem (home: /home/agent) with an in-browser bash interpreter: coreutils, grep/sed/awk, jq, find, etc.
There are no external binaries, no package managers and no network from bash. Files persist across reloads via snapshots.
Be concise. Prefer tools over guessing. When the task is done, reply with a short summary.`;

let agent: Agent | undefined;
let env: BrowserExecutionEnv | undefined;
let turns = 0;
let lastAssistantText: string | undefined;
const persistence: AgentPublicState["persistence"] = { restoredMessages: 0, restoredFiles: 0, dirty: false };

// ---- persistence: fs snapshot (OPFS) + session JSONL ----
let snapshotting: Promise<void> | null = null;
async function snapshotFs(reason: string) {
  if (!env) return;
  if (snapshotting) return snapshotting;
  snapshotting = (async () => {
    try {
      const t0 = performance.now();
      const snap = await env!.snapshot();
      const text = JSON.stringify(snap);
      await opfsWriteText(FS_SNAPSHOT, text);
      persistence.lastSnapshotAt = Date.now(); persistence.snapshotBytes = text.length; persistence.dirty = false;
      log(`fs snapshot (${reason}): ${snap.entries.length} entries, ${text.length} bytes, ${(performance.now() - t0).toFixed(0)}ms`);
    } catch (e) { log(`fs snapshot FAILED: ${e}`); }
  })();
  try { await snapshotting; } finally { snapshotting = null; }
}
async function appendSession(msg: AgentMessage) {
  try { await opfsAppendText(SESSION_LOG, JSON.stringify(msg) + "\n"); persistence.sessionBytes = (await opfsStat(SESSION_LOG))?.size; }
  catch (e) { log(`session append FAILED: ${e}`); }
}
async function loadSession(): Promise<AgentMessage[]> {
  const text = await opfsReadText(SESSION_LOG);
  if (!text) return [];
  const out: AgentMessage[] = [];
  for (const l of text.split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn last line */ } }
  // a transcript must not end with an assistant message that still expects tool results; drop a dangling tail
  while (out.length && out[out.length - 1].role === "assistant" && (out[out.length - 1] as any).stopReason === "toolUse") out.pop();
  return out.filter((m) => m.role !== "system");
}

function publicState(): AgentPublicState {
  const s = agent?.state;
  return {
    model: s?.model?.id ?? "",
    isStreaming: s?.isStreaming ?? false,
    messages: s?.messages.length ?? 0,
    pendingToolCalls: [...(s?.pendingToolCalls ?? [])],
    errorMessage: s?.errorMessage,
    lastAssistantText,
    turns,
    persistence,
  };
}

function tinfoilModel(id: string, baseUrl: string): Model<"openai-completions"> {
  return {
    id,
    name: `Tinfoil ${id}`,
    api: "openai-completions",
    provider: "tinfoil",
    baseUrl,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false, // DeepSeek thinks server-side by default; don't send reasoning params it may reject. TODO revisit
    contextWindow: 128_000,
    maxTokens: 4096,
  };
}

async function init(m: Extract<AgentWorkerIn, { type: "init" }>) {
  const baseUrl = m.baseUrl ?? "https://inference.tinfoil.sh/v1";
  const model = tinfoilModel(m.model, baseUrl);
  const models = createModels();
  models.setProvider(
    createProvider<"openai-completions">({
      id: "tinfoil",
      name: "Tinfoil",
      baseUrl,
      auth: { apiKey: { name: "Tinfoil API key", resolve: async () => ({ auth: { apiKey: m.tinfoilApiKey }, source: "config" }) } },
      models: [model],
      api: openAICompletionsApi(),
    }),
  );
  // restore filesystem + transcript
  try {
    const snapText = await opfsReadText(FS_SNAPSHOT);
    if (snapText) { const snap = JSON.parse(snapText) as FsSnapshot; env = await BrowserExecutionEnv.restore(snap); persistence.restoredFiles = snap.entries.filter((e) => e.type === "file").length; log(`restored fs snapshot from ${new Date(snap.savedAt).toISOString()}: ${snap.entries.length} entries`); }
  } catch (e) { log(`fs restore FAILED (starting empty): ${e}`); }
  env ??= new BrowserExecutionEnv();
  const restored = await loadSession().catch((e) => { log(`session restore FAILED: ${e}`); return [] as AgentMessage[]; });
  persistence.restoredMessages = restored.length;
  if (restored.length) log(`restored ${restored.length} transcript messages`);
  const tools = createBrowserTools(env);
  agent = new Agent({
    streamFn: (mdl, ctx, opts) => models.streamSimple(mdl, ctx, opts),
    initialState: { systemPrompt: SYSTEM_PROMPT, tools, model, thinkingLevel: "off", messages: restored },
    toolExecution: "sequential",
  });
  agent.subscribe(async (event) => {
    if (event.type === "message_end" && (event.message as AgentMessage).role !== "system") await appendSession(event.message as AgentMessage);
    if (event.type === "tool_execution_end") { persistence.dirty = true; await snapshotFs(`after ${event.toolName}`); }
    if (event.type === "turn_end") {
      turns++;
      const msg = event.message as AgentMessage;
      if (msg.role === "assistant") {
        const t = (msg.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join("");
        if (t) lastAssistantText = t;
      }
    }
    // message_update fires per token; forward everything else, and message_update only every so often
    if (event.type !== "message_update") post({ type: "event", event, t: Date.now() });
    if (event.type === "agent_end" || event.type === "tool_execution_end" || event.type === "turn_end") post({ type: "state", state: publicState() });
    // isStreaming only flips after agent_end listeners settle; report the idle state once that happens
    if (event.type === "agent_end") agent!.waitForIdle().then(() => post({ type: "state", state: publicState() }));
  });
  setInterval(() => { if (persistence.dirty) snapshotFs("periodic"); }, SNAPSHOT_INTERVAL_MS);
  log(`ready: model=${m.model} tools=${tools.map((t) => t.name).join(",")}`);
  post({ type: "ready", model: m.model });
  post({ type: "state", state: publicState() });
}

self.onmessage = async (ev: MessageEvent<AgentWorkerIn>) => {
  const m = ev.data;
  try {
    if (m.type === "init") await init(m);
    else if (!agent) post({ type: "error", text: "agent not initialized" });
    else if (m.type === "prompt") {
      if (agent.state.isStreaming) { agent.followUp({ role: "user", content: m.text, timestamp: Date.now() }); log("queued as follow-up"); }
      else { log(`prompt: ${m.text.slice(0, 80)}`); agent.prompt(m.text).catch((e) => post({ type: "error", text: String(e) })); }
    } else if (m.type === "steer") agent.steer({ role: "user", content: m.text, timestamp: Date.now() });
    else if (m.type === "abort") agent.abort();
    else if (m.type === "clear-session") {
      if (agent.state.isStreaming) agent.abort();
      agent.reset(); await opfsRemove(SESSION_LOG); persistence.restoredMessages = 0; persistence.sessionBytes = 0;
      log("session cleared (transcript dropped; filesystem kept)"); post({ type: "state", state: publicState() });
    }
    else if (m.type === "state") post({ type: "state", state: publicState() });
  } catch (e) {
    post({ type: "error", text: (e as Error).stack ?? String(e) });
  }
};
