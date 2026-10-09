import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools/index.js";
import type { ToolDeps } from "./tools/runtime.js";

export const SERVER_NAME = "practice-management";
export const SERVER_VERSION = "0.1.0";

/**
 * Builds a fully wired MCP server. Dependencies are injected so the same
 * factory serves stdio, HTTP (one server per request) and tests.
 */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { logging: {} },
      instructions: [
        "Tools for a professional-services practice-management system (contacts, matters, tasks, time).",
        "Write tools are two-step: call without confirm to get a preview, show it to the user, and only call again with confirm=true after explicit approval.",
        "Always run conflict_check before create_matter.",
      ].join(" "),
    },
  );
  registerTools(server, deps);
  registerResources(server, deps);
  registerPrompts(server);
  return server;
}
