import { describe, expect, it } from "vitest";
import { BrowserExecutionEnv } from "../src/env/browser-env";
import { createBrowserTools } from "../src/tools";

const run = async (tools: ReturnType<typeof createBrowserTools>, name: string, args: any) => {
  const t = tools.find((x) => x.name === name)!;
  const r = await t.execute("call-1", t.prepareArguments ? t.prepareArguments(args) : args, undefined, undefined);
  return { text: (r.content[0] as any).text as string, isError: !!r.isError, details: r.details };
};

describe("BrowserExecutionEnv", () => {
  it("runs bash with pipes, variables and the shared fs", async () => {
    const env = new BrowserExecutionEnv({ files: { "/home/agent/a.txt": "one\ntwo\nthree\n" } });
    const r = await env.exec("cat a.txt | wc -l; echo $((2+3)); X=hi; echo $X; pwd");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3\n5\nhi\n/home/agent\n");
    await env.exec("mkdir -p sub && echo data > sub/f.txt");
    expect(await env.readFile("sub/f.txt")).toBe("data\n");
  });

  it("reports exit codes and times out", async () => {
    const env = new BrowserExecutionEnv();
    expect((await env.exec("exit 3")).exitCode).toBe(3);
    const r = await env.exec("sleep 5", { timeoutMs: 100 });
    expect(r.timedOut).toBe(true);
  });

  it("snapshots and restores the filesystem", async () => {
    const env = new BrowserExecutionEnv();
    await env.exec("mkdir -p d/e && printf 'bin\\x00ary' > d/e/b && echo hello > d/h.txt && ln -s h.txt d/link");
    const snap = await env.snapshot();
    const env2 = await BrowserExecutionEnv.restore(JSON.parse(JSON.stringify(snap)));
    expect((await env2.exec("cat d/h.txt; cat d/link; ls d")).stdout).toBe("hello\nhello\ne\nh.txt\nlink\n");
    expect(await env2.fs.readFileBuffer("/home/agent/d/e/b")).toEqual(new TextEncoder().encode("bin\0ary"));
    expect(env2.cwd).toBe("/home/agent");
  });
});

describe("tools", () => {
  it("write / read / ls / edit / bash round-trip", async () => {
    const env = new BrowserExecutionEnv();
    const tools = createBrowserTools(env);
    expect(tools.map((t) => t.name)).toEqual(["read", "write", "edit", "bash", "ls"]);

    expect((await run(tools, "write", { path: "notes/todo.md", content: "# Todo\n- a\n- b\n" })).text).toMatch(/Successfully wrote 15 bytes/);
    expect((await run(tools, "read", { path: "notes/todo.md" })).text).toBe("# Todo\n- a\n- b\n");
    expect((await run(tools, "read", { path: "notes/todo.md", offset: 2, limit: 1 })).text).toMatch(/^- a\n\n\[Showing lines 2-2 of 4/);
    expect((await run(tools, "ls", {})).text).toBe("notes/");
    expect((await run(tools, "ls", { path: "notes" })).text).toBe("todo.md");

    const e = await run(tools, "edit", { path: "notes/todo.md", edits: [{ oldText: "- a", newText: "- A" }, { oldText: "- b\n", newText: "- b\n- c\n" }] });
    expect(e.text).toMatch(/applied 2 edits/);
    expect(await env.readFile("notes/todo.md")).toBe("# Todo\n- A\n- b\n- c\n");
    await expect(run(tools, "edit", { path: "notes/todo.md", edits: [{ oldText: "-", newText: "*" }] })).rejects.toThrow(/multiple locations/);
    await expect(run(tools, "edit", { path: "notes/todo.md", edits: [{ oldText: "nope", newText: "x" }] })).rejects.toThrow(/could not find/);
    // legacy single-edit shape
    expect((await run(tools, "edit", { path: "notes/todo.md", oldText: "# Todo", newText: "# TODO" })).text).toMatch(/applied 1 edit/);

    const b = await run(tools, "bash", { command: "grep -c '^-' notes/todo.md && echo ok >&2" });
    expect(b.isError).toBe(false);
    expect(b.text).toBe("3\nok");
    const bad = await run(tools, "bash", { command: "cat /nope" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/exited with code 1/);
    await expect(run(tools, "read", { path: "missing.txt" })).rejects.toThrow(/File not found/);
  });
});
