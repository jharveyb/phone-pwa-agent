/// <reference lib="webworker" />
// The agent runtime: pi Agent + Tinfoil (OpenAI-compatible) + BrowserExecutionEnv tools, driven by postMessage.
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { BrowserExecutionEnv } from "./env/browser-env";
import { createBrowserTools } from "./tools";

export type AgentWorkerIn =
  | { type: "init"; tinfoilApiKey: string; model: string; baseUrl?: string }
  | { type: "prompt"; text: string }
  | { type: "steer"; text: string }
  | { type: "abort" }
  | { type: "state" };
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
  env = new BrowserExecutionEnv();
  const tools = createBrowserTools(env);
  agent = new Agent({
    streamFn: (mdl, ctx, opts) => models.streamSimple(mdl, ctx, opts),
    initialState: { systemPrompt: SYSTEM_PROMPT, tools, model, thinkingLevel: "off" },
    toolExecution: "sequential",
  });
  agent.subscribe((event) => {
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
    else if (m.type === "state") post({ type: "state", state: publicState() });
  } catch (e) {
    post({ type: "error", text: (e as Error).stack ?? String(e) });
  }
};
