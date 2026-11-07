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
  | { type: "closed"; id: number };
export type MainToTs =
  | { type: "init"; authKey: string | null; hostname: string; port: number }
  | { type: "response"; id: number; status: number; body: string; headers?: Record<string, string> }
  | { type: "sse-open"; id: number }
  | { type: "sse-event"; id: number; event: string; data: unknown }
  | { type: "close"; id: number };
