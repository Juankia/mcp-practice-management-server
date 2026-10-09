#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAdapter } from "./adapters/factory.js";
import { loadConfig } from "./config.js";
import { IdempotencyStore } from "./core/idempotency.js";
import { createLogger } from "./core/logger.js";
import { createServer } from "./server.js";
import { startHttpServer } from "./transports/http.js";
import type { ToolDeps } from "./tools/runtime.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const deps: ToolDeps = {
    adapter: createAdapter(config, logger),
    logger,
    idempotency: new IdempotencyStore(),
  };

  if (config.MCP_TRANSPORT === "http") {
    const http = await startHttpServer(deps, {
      host: config.MCP_HTTP_HOST,
      port: config.MCP_HTTP_PORT,
      authToken: config.MCP_HTTP_AUTH_TOKEN ?? "",
    });
    const shutdown = (): void => {
      http.close(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  const server = createServer(deps);
  await server.connect(new StdioServerTransport());
  logger.info({ adapter: deps.adapter.name }, "MCP server running on stdio");
}

main().catch((err: unknown) => {
  // stderr only: stdout belongs to the JSON-RPC stream.
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
