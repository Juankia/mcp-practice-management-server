import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers.js";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.close();
});

describe("server surface", () => {
  it("lists all tools with annotations", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_task",
      "conflict_check",
      "create_contact",
      "create_matter",
      "get_matter",
      "list_matters",
      "log_time_entry",
      "search_contacts",
    ]);
    expect(tools.find((t) => t.name === "get_matter")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "create_matter")?.annotations?.destructiveHint).toBe(false);
  });

  it("exposes matter:// resources and reads a snapshot", async () => {
    const { resources } = await h.client.listResources();
    expect(resources.map((r) => r.uri)).toContain("matter://mt_0001");
    expect(resources.map((r) => r.uri)).not.toContain("matter://mt_0005"); // closed

    const read = await h.client.readResource({ uri: "matter://mt_0001" });
    const first = read.contents[0];
    const body = JSON.parse(first && "text" in first ? first.text : "{}") as { matter: { number: string }; tasks: unknown[] };
    expect(body.matter.number).toBe("2026-0001");
    expect(body.tasks).toHaveLength(2);
  });

  it("renders the new-client-intake prompt with a conflict-check-first procedure", async () => {
    const prompt = await h.client.getPrompt({
      name: "new-client-intake",
      arguments: { clientName: "Ada Quill", matterDescription: "Lease dispute", opposingParties: "Harlow Property, Jo Ray" },
    });
    const msg = prompt.messages[0]?.content;
    const text = msg?.type === "text" ? msg.text : "";
    expect(text).toContain('conflict_check with names ["Ada Quill","Harlow Property","Jo Ray"]');
    expect(text).toContain("confirm=true");
  });
});

describe("read tools", () => {
  it("search_contacts returns matches", async () => {
    const { json } = await h.call("search_contacts", { query: "cedar" });
    expect(json).toMatchObject({ count: 1, contacts: [{ id: "ct_0004" }] });
  });

  it("get_matter aggregates client, tasks, time and documents", async () => {
    const { json } = await h.call("get_matter", { matter: "2026-0001" });
    expect(json).toMatchObject({
      client: { id: "ct_0001", name: "Eleanor Whitfield" },
      timeSummary: { entries: 2, totalHours: 3.7, billableHours: 3.7 },
    });
    expect(json.openTasks).toHaveLength(1);
    expect(json.documents).toHaveLength(2);
  });

  it("list_matters filters by status", async () => {
    const { json } = await h.call("list_matters", { status: "closed" });
    expect(json).toMatchObject({ count: 1, matters: [{ number: "2025-0042" }] });
  });

  it("conflict_check flags fuzzy matches against adverse parties", async () => {
    const { json } = await h.call("conflict_check", { names: ["Harlow Property Mgmt", "Ada Quill"] });
    expect(json.status).toBe("potential_conflict");
    expect(json.hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ matterNumber: "2026-0001", severity: "high" })]),
    );
  });

  it("conflict_check is clear for unknown names", async () => {
    const { json } = await h.call("conflict_check", { names: ["Zebulon Featherstonehaugh"] });
    expect(json).toMatchObject({ status: "clear", hits: [] });
  });
});

describe("human-in-the-loop writes", () => {
  const contact = { type: "company", name: "Lakeshore Analytics", email: "legal@lakeshore.example" };

  it("returns a preview and writes nothing when confirm is omitted", async () => {
    const { json } = await h.call("create_contact", contact);
    expect(json).toMatchObject({ status: "preview", wouldWrite: { name: "Lakeshore Analytics" } });
    expect(json.idempotencyKey).toMatch(/^auto-/);

    const search = await h.call("search_contacts", { query: "Lakeshore" });
    expect(search.json.count).toBe(0);
  });

  it("creates on confirm and replays (no duplicate) on retry", async () => {
    const preview = await h.call("create_contact", contact);
    const key = preview.json.idempotencyKey as string;

    const first = await h.call("create_contact", { ...contact, confirm: true, idempotencyKey: key });
    const retry = await h.call("create_contact", { ...contact, confirm: true, idempotencyKey: key });

    expect(first.json).toMatchObject({ status: "created", record: { id: "ct_0008" } });
    expect(retry.json).toMatchObject({ status: "already_created", record: { id: "ct_0008" } });
    expect((await h.call("search_contacts", { query: "Lakeshore" })).json.count).toBe(1);
  });

  it("rejects an idempotency key reused with a different payload", async () => {
    await h.call("create_contact", { ...contact, confirm: true, idempotencyKey: "intake-0001" });
    const { result, json } = await h.call("create_contact", {
      ...contact,
      name: "Different Co",
      email: "x@different.example",
      confirm: true,
      idempotencyKey: "intake-0001",
    });
    expect(result.isError).toBe(true);
    expect(json).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED", retryable: false } });
  });

  it("previews possible duplicates when creating a contact", async () => {
    const { json } = await h.call("create_contact", { type: "person", name: "Marcus Oyelaran" });
    expect(json).toMatchObject({ status: "preview", context: { possibleDuplicates: [{ id: "ct_0003" }] } });
  });

  it("create_matter validates the client during preview", async () => {
    const { result, json } = await h.call("create_matter", {
      clientId: "ct_9999",
      title: "Ghost matter",
      practiceArea: "Litigation",
      responsibleAttorney: "A. Reyes",
    });
    expect(result.isError).toBe(true);
    expect(json).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("create_matter commits with parties after confirmation", async () => {
    const args = {
      clientId: "ct_0007",
      title: "Brannigan v. Coastal Freight",
      practiceArea: "Personal Injury",
      responsibleAttorney: "A. Reyes",
      parties: [{ name: "Coastal Freight Inc.", role: "opposing_party" }],
    };
    const preview = await h.call("create_matter", args);
    expect(preview.json).toMatchObject({ status: "preview", context: { client: { name: "Theodore Brannigan" } } });

    const { json } = await h.call("create_matter", { ...args, confirm: true });
    expect(json).toMatchObject({ status: "created", record: { number: "2026-0005", status: "open" } });
  });

  it("add_task accepts a matter number and refuses closed matters", async () => {
    const ok = await h.call("add_task", { matter: "2026-0003", title: "Send engagement letter", dueDate: "2026-10-15", confirm: true });
    expect(ok.json).toMatchObject({ status: "created", record: { matterId: "mt_0003", dueDate: "2026-10-15" } });

    const closed = await h.call("add_task", { matter: "2025-0042", title: "Late task" });
    expect(closed.result.isError).toBe(true);
    expect(closed.json).toMatchObject({ error: { code: "CONFLICT" } });
  });

  it("log_time_entry enforces 0.1h increments via the input schema", async () => {
    const bad = await h.call("log_time_entry", {
      matter: "mt_0002",
      date: "2026-10-08",
      hours: 1.25,
      description: "Contract review",
      timekeeper: "J. Castillo",
    });
    expect(bad.result.isError).toBe(true);
    expect(bad.json.raw).toContain("0.1-hour");

    const good = await h.call("log_time_entry", {
      matter: "mt_0002",
      date: "2026-10-08",
      hours: 1.3,
      description: "Contract review",
      timekeeper: "J. Castillo",
      confirm: true,
    });
    expect(good.json).toMatchObject({ status: "created", record: { hours: 1.3, billable: true } });
  });
});

describe("audit log", () => {
  it("writes one structured line per tool call with outcome and redacted PII", async () => {
    await h.call("create_contact", { type: "person", name: "Ada Quill", email: "ada@example.com" });
    await h.call("get_matter", { matter: "does-not-exist" });

    const calls = h.auditLines.filter((l) => l.event === "tool_call");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ tool: "create_contact", kind: "write", outcome: "preview", args: { email: "[REDACTED]" } });
    expect(calls[1]).toMatchObject({ tool: "get_matter", outcome: "error", errorCode: "NOT_FOUND" });
    expect(typeof calls[0]?.requestId).toBe("string");
    expect(typeof calls[0]?.durationMs).toBe("number");
  });
});
