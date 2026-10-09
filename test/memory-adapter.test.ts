import { describe, expect, it } from "vitest";
import { InMemoryPracticeAdapter } from "../src/adapters/memory-adapter.js";

const ctx = { requestId: "test" };
const fixedNow = () => new Date("2026-10-09T12:00:00.000Z");

describe("InMemoryPracticeAdapter", () => {
  it("searches contacts by name, email and phone digits", async () => {
    const a = new InMemoryPracticeAdapter();
    expect((await a.searchContacts("whitfield", 10, ctx)).map((c) => c.id)).toEqual(["ct_0001"]);
    expect((await a.searchContacts("bluefin-logistics", 10, ctx)).map((c) => c.id)).toEqual(["ct_0002"]);
    expect((await a.searchContacts("555-0104", 10, ctx)).map((c) => c.id)).toEqual(["ct_0004"]);
  });

  it("finds matters by id or number and filters lists", async () => {
    const a = new InMemoryPracticeAdapter();
    expect((await a.getMatter("2026-0002", ctx)).id).toBe("mt_0002");
    const open = await a.listMatters({ status: "open" }, ctx);
    expect(open.every((m) => m.status === "open")).toBe(true);
    const employment = await a.listMatters({ practiceArea: "employ" }, ctx);
    expect(employment.map((m) => m.id)).toEqual(["mt_0004"]);
  });

  it("throws NOT_FOUND for unknown records", async () => {
    const a = new InMemoryPracticeAdapter();
    await expect(a.getMatter("nope", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.getContact("nope", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a matter with a sequential number and the client as a party", async () => {
    const a = new InMemoryPracticeAdapter({ now: fixedNow });
    const m = await a.createMatter(
      {
        clientId: "ct_0005",
        title: "Valdivieso Trademark Filing",
        practiceArea: "Intellectual Property",
        responsibleAttorney: "M. Lindqvist",
        parties: [],
      },
      ctx,
    );
    expect(m).toMatchObject({ id: "mt_0006", number: "2026-0005", status: "open" });
    expect(m.parties).toEqual([{ name: "Sofía Valdivieso", role: "client" }]);
  });

  it("refuses work on closed matters and duplicate emails", async () => {
    const a = new InMemoryPracticeAdapter();
    await expect(
      a.createTask({ matterId: "mt_0005", title: "Anything" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      a.createContact({ type: "person", name: "Someone", email: "ELEANOR.WHITFIELD@example.com" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("isolates state between instances and from returned objects", async () => {
    const a = new InMemoryPracticeAdapter();
    const b = new InMemoryPracticeAdapter();
    await a.createContact({ type: "company", name: "Lakeshore Analytics" }, ctx);
    expect(await b.searchContacts("Lakeshore", 10, ctx)).toHaveLength(0);

    const m = await a.getMatter("mt_0001", ctx);
    m.title = "mutated";
    expect((await a.getMatter("mt_0001", ctx)).title).not.toBe("mutated");
  });
});
