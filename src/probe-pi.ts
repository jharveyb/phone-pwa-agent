/// <reference lib="webworker" />
// Spike B probe: does pi-agent-core / pi-ai / just-bash import cleanly in a browser worker?
const post = (text: string) => self.postMessage({ type: "log", text: `[probe] ${text}` });
(async () => {
  try {
    let t = performance.now();
    const core = await import("@earendil-works/pi-agent-core");
    post(`pi-agent-core ok ${(performance.now() - t).toFixed(0)}ms exports=${Object.keys(core).join(",")}`);
    t = performance.now();
    const ai = await import("@earendil-works/pi-ai");
    post(`pi-ai ok ${(performance.now() - t).toFixed(0)}ms createModels=${typeof ai.createModels} createProvider=${typeof ai.createProvider}`);
    t = performance.now();
    const compl = await import("@earendil-works/pi-ai/api/openai-completions.lazy");
    post(`openai-completions.lazy ok ${(performance.now() - t).toFixed(0)}ms exports=${Object.keys(compl).join(",")}`);
    t = performance.now();
    const jb = await import("just-bash/browser");
    post(`just-bash/browser ok ${(performance.now() - t).toFixed(0)}ms Bash=${typeof jb.Bash} InMemoryFs=${typeof jb.InMemoryFs}`);
    const bash = new jb.Bash({ files: { "/home/agent/hello.txt": "hi from just-bash\n" }, cwd: "/home/agent" });
    const r = await bash.exec("echo $((6*7)); cat hello.txt | tr a-z A-Z; ls -la; pwd; uname -a || true");
    post(`bash exec exit=${r.exitCode} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
    const agent = new core.Agent({ streamFn: (() => { throw new Error("no stream"); }) as any, initialState: { systemPrompt: "x", tools: [] } });
    post(`Agent constructed; state keys=${Object.keys(agent.state).join(",")} isStreaming=${agent.state.isStreaming}`);
    post("DONE");
  } catch (e) {
    post(`FAILED ${(e as Error).stack ?? e}`);
  }
})();
