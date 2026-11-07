// Minimal HTTP/1.1 request parsing + response building over a raw TCP connection (tailscale-web Connection).
// Supports: request line, headers, Content-Length bodies, one request per connection (Connection: close),
// and server-sent-event responses that stay open.
export interface HttpRequest {
  method: string;
  path: string; // without query
  query: Record<string, string>; // plain object: must survive structured clone (postMessage)
  headers: Record<string, string>;
  body: string;
}

export class RequestParser {
  private buf = new Uint8Array(0);
  /** Feed bytes; returns a request once complete, else undefined. */
  push(chunk: Uint8Array): HttpRequest | undefined {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf); merged.set(chunk, this.buf.length);
    this.buf = merged;
    const headEnd = indexOfSeq(this.buf, [13, 10, 13, 10]);
    if (headEnd < 0) return undefined;
    const head = new TextDecoder().decode(this.buf.subarray(0, headEnd));
    const [reqLine, ...headerLines] = head.split("\r\n");
    const [method = "GET", target = "/"] = reqLine.split(" ");
    const headers: Record<string, string> = {};
    for (const l of headerLines) { const i = l.indexOf(":"); if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
    const len = parseInt(headers["content-length"] ?? "0", 10) || 0;
    const bodyStart = headEnd + 4;
    if (this.buf.length < bodyStart + len) return undefined;
    const body = new TextDecoder().decode(this.buf.subarray(bodyStart, bodyStart + len));
    this.buf = this.buf.subarray(bodyStart + len);
    const q = target.indexOf("?");
    return { method: method.toUpperCase(), path: q >= 0 ? target.slice(0, q) : target, query: Object.fromEntries(new URLSearchParams(q >= 0 ? target.slice(q + 1) : "")), headers, body };
  }
}

function indexOfSeq(hay: Uint8Array, seq: number[]): number {
  outer: for (let i = 0; i <= hay.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) if (hay[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

const REASONS: Record<number, string> = { 200: "OK", 202: "Accepted", 204: "No Content", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error", 503: "Service Unavailable" };

export function buildResponse(status: number, body: string | Uint8Array, headers: Record<string, string> = {}): Uint8Array {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const h: Record<string, string> = { "content-type": "text/plain; charset=utf-8", "content-length": String(bytes.length), connection: "close", "access-control-allow-origin": "*", ...headers };
  const head = `HTTP/1.1 ${status} ${REASONS[status] ?? "Status"}\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n";
  const hb = new TextEncoder().encode(head);
  const out = new Uint8Array(hb.length + bytes.length); out.set(hb); out.set(bytes, hb.length);
  return out;
}
export const json = (status: number, obj: unknown) => buildResponse(status, JSON.stringify(obj, null, 1) + "\n", { "content-type": "application/json; charset=utf-8" });

/** Headers for a streaming SSE response (no content-length; connection stays open). */
export function sseHead(): string {
  return "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-store\r\nconnection: close\r\naccess-control-allow-origin: *\r\n\r\n";
}
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
