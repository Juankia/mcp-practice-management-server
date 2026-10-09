import { Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryPracticeAdapter } from "../src/adapters/memory-adapter.js";
import { IdempotencyStore } from "../src/core/idempotency.js";
import { createLogger } from "../src/core/logger.js";
import { createServer } from "../src/server.js";
import type { ToolDeps } from "../src/tools/runtime.js";

export interface Harness {
  client: Client;
  deps: ToolDeps;
  auditLines: Record<string, unknown>[];
  call: (name: string, args?: Record<string, unknown>) => Promise<{ result: CallToolResult; json: Record<string, unknown> }>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const auditLines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        auditLines.push(JSON.parse(line) as Record<string, unknown>);
      }
      cb();
    },
  });

  const deps: ToolDeps = {
    adapter: new InMemoryPracticeAdapter({ now: () => new Date("2026-10-09T12:00:00.000Z") }),
    logger: createLogger("info", sink),
    idempotency: new IdempotencyStore(),
  };

  const server = createServer(deps);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call: Harness["call"] = async (name, args = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const first = result.content[0];
    const text = first?.type === "text" ? first.text : "";
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // SDK-level input-validation errors are plain text, not our JSON envelope.
      json = { raw: text };
    }
    return { result, json };
  };

  return {
    client,
    deps,
    auditLines,
    call,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
