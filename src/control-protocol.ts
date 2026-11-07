// Messages between the tailscale worker (HTTP listener) and the main thread (router).
import type { HttpRequest } from "./http";
export type TsToMain =
  | { type: "log"; text: string }
  | { type: "ready"; ip4: string; ip6: string; initMs: number }
  | { type: "listening"; port: number }
  | { type: "authRequired"; url: string }
  | { type: "error"; text: string }
  | { type: "tsStatus"; text: string }
  | { type: "http"; id: number; req: HttpRequest }
  | { type: "fetch-result"; id: number; ok: boolean; status?: number; headers?: Record<string, string>; body?: string; error?: string; viaExitNode?: string }
  | { type: "closed"; id: number };
export type MainToTs =
  | { type: "init"; authKey: string | null; hostname: string; port: number; exitNode?: string | null }
  | { type: "fetch"; id: number; url: string; init?: { method?: string; headers?: Record<string, string>; body?: string }; maxBytes?: number }
  | { type: "response"; id: number; status: number; body: string; headers?: Record<string, string> }
  | { type: "sse-open"; id: number }
  | { type: "sse-event"; id: number; event: string; data: unknown }
  | { type: "close"; id: number };
