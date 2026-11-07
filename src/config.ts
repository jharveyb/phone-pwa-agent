export interface AppConfig {
  tsAuthKey: string | null;
  tsHostname: string;
  tinfoilApiKey: string | null;
  tinfoilModel: string | null;
  tsExitNode: string | null;
}
export async function loadConfig(): Promise<AppConfig> {
  const r = await fetch("/__config.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`config endpoint ${r.status}`);
  return r.json();
}
