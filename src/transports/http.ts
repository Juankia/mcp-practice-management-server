import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";
import type { ToolDeps } from "../tools/runtime.js";

export interface HttpOptions {
  host: string;
  port: number;
  authToken: string;
  maxBodyBytes?: number;
}

/**
 * Stateless Streamable HTTP transport.
 *
 * A fresh McpServer + transport is created per POST, while the adapter, token
 * cache and idempotency store are shared — so the process scales horizontally
 * once the idempotency store is externalized.
 */
export function startHttpServer(deps: ToolDeps, opts: HttpOptions): Promise<Server> {
  const expected = Buffer.from(`Bearer ${opts.authToken}`);
  const maxBody = opts.maxBodyBytes ?? 1_000_000;
  const log = deps.logger.child({ component: "http" });

  const httpServer = createHttpServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log.error({ err }, "unhandled HTTP error");
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, "Internal server error"));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", adapter: deps.adapter.name });
      return;
    }
    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    if (!isAuthorized(req.headers.authorization, expected)) {
      res.setHeader("www-authenticate", 'Bearer realm="mcp"');
      sendJson(res, 401, rpcError(-32001, "Unauthorized"));
      return;
    }
    if (req.method !== "POST") {
      // Stateless mode: no server-initiated SSE stream and no sessions to delete.
      res.setHeader("allow", "POST");
      sendJson(res, 405, rpcError(-32000, "Method not allowed"));
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, maxBody));
    } catch {
      sendJson(res, 400, rpcError(-32700, "Parse error"));
      return;
    }

    const server = createServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => {
      log.info({ host: opts.host, port: opts.port }, "Streamable HTTP transport listening on /mcp");
      resolve(httpServer);
    });
  });
}

function isAuthorized(header: string | undefined, expected: Buffer): boolean {
  if (!header) return false;
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });
