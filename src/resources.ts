import { randomUUID } from "node:crypto";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./tools/runtime.js";

/**
 * Read-only resources. `matter://{id}` gives a client a stable, attachable
 * snapshot of a matter (handy for "@-mentioning" a case in Claude).
 */
export function registerResources(server: McpServer, deps: ToolDeps): void {
  const { adapter, logger } = deps;

  server.registerResource(
    "matter",
    new ResourceTemplate("matter://{id}", {
      list: async () => {
        const matters = await adapter.listMatters({ limit: 100 }, { requestId: randomUUID() });
        return {
          resources: matters
            .filter((m) => m.status !== "closed")
            .map((m) => ({
              uri: `matter://${m.id}`,
              name: `${m.number} — ${m.title}`,
              mimeType: "application/json",
            })),
        };
      },
      complete: {
        id: async (value) => {
          const matters = await adapter.listMatters({ limit: 100 }, { requestId: randomUUID() });
          return matters.map((m) => m.id).filter((id) => id.startsWith(value));
        },
      },
    }),
    {
      title: "Matter snapshot",
      description: "A matter with its parties, tasks, time entries and document metadata, as JSON.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const ctx = { requestId: randomUUID() };
      const matterId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
      const matter = await adapter.getMatter(matterId, ctx);
      const [tasks, timeEntries, documents] = await Promise.all([
        adapter.listTasks(matter.id, ctx),
        adapter.listTimeEntries(matter.id, ctx),
        adapter.listDocuments(matter.id, ctx),
      ]);
      logger.info({ event: "resource_read", uri: uri.href, requestId: ctx.requestId }, "resource read");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ matter, tasks, timeEntries, documents }, null, 2),
          },
        ],
      };
    },
  );
}
