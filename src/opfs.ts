// OPFS helpers (worker-side: sync access handles are only available in dedicated workers).
async function root() { return navigator.storage.getDirectory(); }

export async function opfsReadText(name: string): Promise<string | null> {
  try {
    const h = await (await root()).getFileHandle(name);
    return await (await h.getFile()).text();
  } catch (e) { if ((e as DOMException).name === "NotFoundError") return null; throw e; }
}

/** Atomic-ish write: write <name>.tmp with a sync handle, then move over <name> (falls back to direct write). */
export async function opfsWriteText(name: string, text: string): Promise<void> {
  const dir = await root();
  const bytes = new TextEncoder().encode(text);
  const write = async (h: FileSystemFileHandle) => {
    const a = await (h as any).createSyncAccessHandle();
    try { a.truncate(0); a.write(bytes, { at: 0 }); a.flush(); } finally { a.close(); }
  };
  const tmp = await dir.getFileHandle(`${name}.tmp`, { create: true });
  await write(tmp);
  if (typeof (tmp as any).move === "function") await (tmp as any).move(name);
  else { await write(await dir.getFileHandle(name, { create: true })); await dir.removeEntry(`${name}.tmp`); }
}

export async function opfsAppendText(name: string, text: string): Promise<void> {
  const h = await (await root()).getFileHandle(name, { create: true });
  const a = await (h as any).createSyncAccessHandle();
  try { const size = a.getSize(); a.write(new TextEncoder().encode(text), { at: size }); a.flush(); } finally { a.close(); }
}

export async function opfsRemove(name: string): Promise<void> {
  try { await (await root()).removeEntry(name); } catch (e) { if ((e as DOMException).name !== "NotFoundError") throw e; }
}

export async function opfsStat(name: string): Promise<{ size: number; lastModified: number } | null> {
  try { const f = await (await (await root()).getFileHandle(name)).getFile(); return { size: f.size, lastModified: f.lastModified }; }
  catch (e) { if ((e as DOMException).name === "NotFoundError") return null; throw e; }
}
