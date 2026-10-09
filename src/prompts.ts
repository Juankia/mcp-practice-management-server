import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Reusable, server-curated workflows that encode the firm's intake policy. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "new-client-intake",
    {
      title: "New client intake",
      description: "Guided, policy-compliant workflow: conflict check -> contact -> matter -> first task, with approvals.",
      argsSchema: {
        clientName: z.string().min(2).describe("Prospective client (person or company)."),
        matterDescription: z.string().min(5).describe("Short description of the engagement."),
        opposingParties: z.string().optional().describe("Comma-separated adverse parties, if any."),
        responsibleAttorney: z.string().optional(),
      },
    },
    ({ clientName, matterDescription, opposingParties, responsibleAttorney }) => {
      const adverse = (opposingParties ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const names = [clientName, ...adverse];
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Run new-client intake for "${clientName}".`,
                `Engagement: ${matterDescription}`,
                adverse.length ? `Adverse parties: ${adverse.join("; ")}` : "No adverse parties provided.",
                responsibleAttorney ? `Responsible attorney: ${responsibleAttorney}` : "",
                "",
                "Follow this procedure exactly:",
                `1. Call conflict_check with names ${JSON.stringify(names)}. If status is "potential_conflict", STOP, summarize every hit (severity, score, matter number) and ask the user how to proceed. Never dismiss a hit yourself.`,
                `2. Call search_contacts for "${clientName}". Reuse an existing contact if it is clearly the same client; otherwise call create_contact WITHOUT confirm to get a preview.`,
                "3. Show the preview to the user. Only after they explicitly approve, repeat the call with confirm=true and the idempotencyKey from the preview.",
                "4. Do the same preview -> approval -> confirm cycle for create_matter (include the adverse parties with role opposing_party).",
                "5. Propose a first task (e.g. 'Send engagement letter') via add_task, again preview first.",
                "6. Finish with a short summary: contact id, matter number, task id, and any open questions.",
              ]
                .filter((line) => line !== "")
                .join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "matter-status-brief",
    {
      title: "Matter status brief",
      description: "Summarize where a matter stands: parties, open tasks, upcoming deadlines and time recorded.",
      argsSchema: { matter: z.string().min(1).describe("Matter id or number.") },
    },
    ({ matter }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Call get_matter for "${matter}" and write a concise status brief for the responsible attorney: one-line summary, parties, open tasks ordered by due date (flag anything due within 7 days), billable vs non-billable hours, and recent documents. Do not create or modify anything.`,
          },
        },
      ],
    }),
  );
}
