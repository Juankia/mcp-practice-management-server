import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runConflictCheck } from "../core/conflicts.js";
import { AppError } from "../core/errors.js";
import type { Matter } from "../domain.js";
import { auditedTool, guardedWrite, type ToolDeps } from "./runtime.js";
import { confirmField, idempotencyKeyField, isoDateField, matterRefField, partyRoleField } from "./schemas.js";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { adapter } = deps;

  // ------------------------------------------------------------------ reads

  server.registerTool(
    "search_contacts",
    {
      title: "Search contacts",
      description: "Search people and companies in the practice-management system by name, email or phone.",
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe("Name, email or phone fragment."),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: READ,
    },
    auditedTool("search_contacts", "read", deps, async ({ query, limit }, ctx) => {
      const contacts = await adapter.searchContacts(query, limit, ctx);
      return { data: { count: contacts.length, contacts } };
    }),
  );

  server.registerTool(
    "list_matters",
    {
      title: "List matters",
      description: "List matters (cases/engagements), newest first, optionally filtered by status, client or practice area.",
      inputSchema: {
        status: z.enum(["open", "pending", "closed"]).optional(),
        clientId: z.string().max(64).optional(),
        practiceArea: z.string().max(100).optional().describe("Case-insensitive substring match."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: READ,
    },
    auditedTool("list_matters", "read", deps, async (args, ctx) => {
      const matters = await adapter.listMatters(args, ctx);
      return {
        data: {
          count: matters.length,
          matters: matters.map((m) => ({
            id: m.id,
            number: m.number,
            title: m.title,
            status: m.status,
            practiceArea: m.practiceArea,
            responsibleAttorney: m.responsibleAttorney,
            clientId: m.clientId,
            openedAt: m.openedAt,
          })),
        },
      };
    }),
  );

  server.registerTool(
    "get_matter",
    {
      title: "Get matter",
      description:
        "Get a matter with its client, parties, open tasks, time summary and document metadata. Accepts an id or matter number.",
      inputSchema: { matter: matterRefField },
      annotations: READ,
    },
    auditedTool("get_matter", "read", deps, async ({ matter: ref }, ctx) => {
      const matter = await adapter.getMatter(ref, ctx);
      const [client, tasks, time, documents] = await Promise.all([
        adapter.getContact(matter.clientId, ctx),
        adapter.listTasks(matter.id, ctx),
        adapter.listTimeEntries(matter.id, ctx),
        adapter.listDocuments(matter.id, ctx),
      ]);
      const billable = time.filter((t) => t.billable).reduce((s, t) => s + t.hours, 0);
      const total = time.reduce((s, t) => s + t.hours, 0);
      return {
        data: {
          matter,
          client: { id: client.id, name: client.name, type: client.type },
          openTasks: tasks.filter((t) => t.status === "open"),
          timeSummary: { entries: time.length, totalHours: round1(total), billableHours: round1(billable) },
          documents,
        },
      };
    }),
  );

  server.registerTool(
    "conflict_check",
    {
      title: "Conflict check",
      description:
        "Screen one or more names (prospective client, opposing parties, related parties) against all contacts and matter parties using fuzzy matching. Run this BEFORE opening a new matter.",
      inputSchema: {
        names: z.array(z.string().trim().min(2).max(200)).min(1).max(20),
        threshold: z
          .number()
          .min(0.5)
          .max(1)
          .default(0.88)
          .describe("Minimum similarity (0.5-1). Lower = more recall, more noise."),
      },
      annotations: READ,
    },
    auditedTool("conflict_check", "read", deps, async ({ names, threshold }, ctx) => {
      const candidates = await adapter.findConflictCandidates(names, ctx);
      const report = runConflictCheck(names, candidates, threshold);
      return { data: { ...report } };
    }),
  );

  // ----------------------------------------------------------------- writes

  server.registerTool(
    "create_contact",
    {
      title: "Create contact",
      description:
        "Create a person or company contact. Two-step: first call returns a preview; call again with confirm=true after the user approves.",
      inputSchema: {
        type: z.enum(["person", "company"]),
        name: z.string().trim().min(2).max(200),
        email: z.email().optional(),
        phone: z
          .string()
          .regex(/^\+?[0-9 ().-]{7,20}$/, "Invalid phone number")
          .optional(),
        idempotencyKey: idempotencyKeyField,
        confirm: confirmField,
      },
      annotations: CREATE,
    },
    auditedTool("create_contact", "write", deps, async ({ confirm, idempotencyKey, ...payload }, ctx) =>
      guardedWrite({
        tool: "create_contact",
        payload,
        confirm,
        idempotencyKey,
        summary: `Create ${payload.type} contact "${payload.name}"`,
        validate: async (c) => {
          const similar = await adapter.searchContacts(payload.name, 5, c);
          return similar.length > 0 ? { possibleDuplicates: similar } : undefined;
        },
        commit: (c) => adapter.createContact(payload, c),
        deps,
        ctx,
      }),
    ),
  );

  server.registerTool(
    "create_matter",
    {
      title: "Create matter",
      description:
        "Open a new matter for an existing client contact. Run conflict_check first. Two-step: preview, then confirm=true after user approval.",
      inputSchema: {
        clientId: z.string().min(1).max(64),
        title: z.string().trim().min(3).max(200),
        practiceArea: z.string().trim().min(2).max(100),
        responsibleAttorney: z.string().trim().min(2).max(100),
        parties: z
          .array(z.object({ name: z.string().trim().min(2).max(200), role: partyRoleField }))
          .max(50)
          .default([]),
        idempotencyKey: idempotencyKeyField,
        confirm: confirmField,
      },
      annotations: CREATE,
    },
    auditedTool("create_matter", "write", deps, async ({ confirm, idempotencyKey, ...payload }, ctx) =>
      guardedWrite({
        tool: "create_matter",
        payload,
        confirm,
        idempotencyKey,
        summary: `Open matter "${payload.title}" (${payload.practiceArea}) for client ${payload.clientId}`,
        validate: async (c) => {
          const client = await adapter.getContact(payload.clientId, c);
          return { client: { id: client.id, name: client.name } };
        },
        commit: (c) => adapter.createMatter(payload, c),
        deps,
        ctx,
      }),
    ),
  );

  server.registerTool(
    "add_task",
    {
      title: "Add task",
      description: "Add a task to an open matter. Two-step: preview, then confirm=true after user approval.",
      inputSchema: {
        matter: matterRefField,
        title: z.string().trim().min(3).max(200),
        dueDate: isoDateField.optional(),
        assignee: z.string().trim().min(2).max(100).optional(),
        idempotencyKey: idempotencyKeyField,
        confirm: confirmField,
      },
      annotations: CREATE,
    },
    auditedTool("add_task", "write", deps, async ({ confirm, idempotencyKey, matter: ref, ...rest }, ctx) => {
      const matter = assertOpen(await adapter.getMatter(ref, ctx));
      const payload = { matterId: matter.id, ...rest };
      return guardedWrite({
        tool: "add_task",
        payload,
        confirm,
        idempotencyKey,
        summary: `Add task "${rest.title}" to matter ${matter.number}${rest.dueDate ? ` due ${rest.dueDate}` : ""}`,
        validate: () => Promise.resolve({ matter: { id: matter.id, number: matter.number, status: matter.status } }),
        commit: (c) => adapter.createTask(payload, c),
        deps,
        ctx,
      });
    }),
  );

  server.registerTool(
    "log_time_entry",
    {
      title: "Log time entry",
      description:
        "Record time worked on an open matter, in 0.1-hour increments. Two-step: preview, then confirm=true after user approval.",
      inputSchema: {
        matter: matterRefField,
        date: isoDateField,
        hours: z
          .number()
          .min(0.1)
          .max(24)
          .refine((h) => Math.abs(h * 10 - Math.round(h * 10)) < 1e-9, "Use 0.1-hour (6-minute) increments")
          .describe("Hours worked, e.g. 1.5"),
        description: z.string().trim().min(5).max(1000).describe("Narrative that will appear on the invoice."),
        timekeeper: z.string().trim().min(2).max(100),
        billable: z.boolean().default(true),
        idempotencyKey: idempotencyKeyField,
        confirm: confirmField,
      },
      annotations: CREATE,
    },
    auditedTool("log_time_entry", "write", deps, async ({ confirm, idempotencyKey, matter: ref, ...rest }, ctx) => {
      const matter = assertOpen(await adapter.getMatter(ref, ctx));
      const payload = { matterId: matter.id, ...rest };
      return guardedWrite({
        tool: "log_time_entry",
        payload,
        confirm,
        idempotencyKey,
        summary: `Log ${rest.hours}h (${rest.billable ? "billable" : "non-billable"}) on ${rest.date} to matter ${matter.number} for ${rest.timekeeper}`,
        validate: () => Promise.resolve({ matter: { id: matter.id, number: matter.number, status: matter.status } }),
        commit: (c) => adapter.createTimeEntry(payload, c),
        deps,
        ctx,
      });
    }),
  );
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function assertOpen(matter: Matter): Matter {
  if (matter.status === "closed") {
    throw new AppError("CONFLICT", `Matter ${matter.number} is closed; reopen it before adding work.`, {
      matterId: matter.id,
    });
  }
  return matter;
}
