import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryPracticeAdapter } from "../src/adapters/memory-adapter.js";
import { loadConfig } from "../src/config.js";
import { IdempotencyStore } from "../src/core/idempotency.js";
import { createLogger } from "../src/core/logger.js";
import { startHttpServer } from "../src/transports/http.js";

describe("loadConfig", () => {
  it("defaults to the in-memory adapter over stdio", () => {
    expect(loadConfig({})).toMatchObject({ PM_ADAPTER: "memory", MCP_TRANSPORT: "stdio", MCP_HTTP_PORT: 3333 });
  });

  it("requires OAuth settings for the REST adapter", () => {
    expect(() => loadConfig({ PM_ADAPTER: "rest" })).toThrow(/PM_OAUTH_CLIENT_SECRET is required/);
  });

  it("requires an auth token for the HTTP transport", () => {
    expect(() => loadConfig({ MCP_TRANSPORT: "http" })).toThrow(/MCP_HTTP_AUTH_TOKEN/);
  });
});

describe("Streamable HTTP transport", () => {
  const token = "test-token-0123456789";
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHttpServer(
      {
        adapter: new InMemoryPracticeAdapter(),
        logger: createLogger("silent"),
        idempotency: new IdempotencyStore(),
      },
      { host: "127.0.0.1", port: 0, authToken: token },
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  });

  it("serves a health check", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(await res.json()).toEqual({ status: "ok", adapter: "memory" });
  });

  it("rejects requests without the bearer token", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("serves MCP to an authenticated client", async () => {
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);

    const result = await client.callTool({ name: "search_contacts", arguments: { query: "Bluefin" } });
    expect(JSON.stringify(result.content)).toContain("ct_0002");
    await client.close();
  });
});
