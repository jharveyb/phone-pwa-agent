const log = document.getElementById("log")!;
const line = (s: string) => { log.textContent += s + "\n"; console.log(s); };
line("probe page up");
const w = new Worker(new URL("./probe-pi.ts", import.meta.url), { type: "module", name: "probe" });
w.onmessage = (ev) => line(ev.data.text);
w.onerror = (e) => line(`worker error: ${e.message} ${e.filename}:${e.lineno}`);
