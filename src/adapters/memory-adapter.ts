import type {
  ConflictRecord,
  Contact,
  CreateContactInput,
  CreateMatterInput,
  CreateTaskInput,
  CreateTimeEntryInput,
  DocumentMeta,
  Matter,
  MatterFilter,
  Task,
  TimeEntry,
} from "../domain.js";
import { AppError, notFound } from "../core/errors.js";
import type { CallContext, PracticeManagementAdapter } from "./adapter.js";
import { createSeedData, type SeedData } from "./seed.js";

export interface MemoryAdapterOptions {
  seed?: SeedData;
  now?: () => Date;
}

/**
 * In-memory backend with fictional seed data. It is the default adapter so the
 * server is fully usable (and testable) with zero credentials.
 */
export class InMemoryPracticeAdapter implements PracticeManagementAdapter {
  readonly name = "memory";
  private readonly data: SeedData;
  private readonly now: () => Date;

  constructor(opts: MemoryAdapterOptions = {}) {
    this.data = structuredClone(opts.seed ?? createSeedData());
    this.now = opts.now ?? (() => new Date());
  }

  searchContacts(query: string, limit: number, _ctx: CallContext): Promise<Contact[]> {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const results = this.data.contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (digits.length >= 3 && (c.phone?.replace(/\D/g, "").includes(digits) ?? false)),
    );
    return Promise.resolve(results.slice(0, limit).map(clone));
  }

  getContact(id: string, _ctx: CallContext): Promise<Contact> {
    const contact = this.data.contacts.find((c) => c.id === id);
    if (!contact) return Promise.reject(notFound("Contact", id));
    return Promise.resolve(clone(contact));
  }

  createContact(input: CreateContactInput, _ctx: CallContext): Promise<Contact> {
    if (input.email && this.data.contacts.some((c) => c.email?.toLowerCase() === input.email?.toLowerCase())) {
      return Promise.reject(new AppError("CONFLICT", `A contact with email '${input.email}' already exists.`));
    }
    const contact: Contact = {
      id: this.nextId("ct", this.data.contacts),
      type: input.type,
      name: input.name.trim(),
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      createdAt: this.now().toISOString(),
    };
    this.data.contacts.push(contact);
    return Promise.resolve(clone(contact));
  }

  listMatters(filter: MatterFilter, _ctx: CallContext): Promise<Matter[]> {
    const area = filter.practiceArea?.toLowerCase();
    const results = this.data.matters
      .filter((m) => (filter.status ? m.status === filter.status : true))
      .filter((m) => (filter.clientId ? m.clientId === filter.clientId : true))
      .filter((m) => (area ? m.practiceArea.toLowerCase().includes(area) : true))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return Promise.resolve(results.slice(0, filter.limit ?? 25).map(clone));
  }

  getMatter(idOrNumber: string, _ctx: CallContext): Promise<Matter> {
    const matter = this.data.matters.find((m) => m.id === idOrNumber || m.number === idOrNumber);
    if (!matter) return Promise.reject(notFound("Matter", idOrNumber));
    return Promise.resolve(clone(matter));
  }

  async createMatter(input: CreateMatterInput, ctx: CallContext): Promise<Matter> {
    const client = await this.getContact(input.clientId, ctx);
    const now = this.now();
    const year = now.getUTCFullYear();
    const sameYear = this.data.matters.filter((m) => m.number.startsWith(`${year}-`)).length;
    const parties = input.parties.some((p) => p.role === "client")
      ? input.parties
      : [{ name: client.name, role: "client" as const }, ...input.parties];

    const matter: Matter = {
      id: this.nextId("mt", this.data.matters),
      number: `${year}-${String(sameYear + 1).padStart(4, "0")}`,
      title: input.title.trim(),
      clientId: client.id,
      status: "open",
      practiceArea: input.practiceArea,
      responsibleAttorney: input.responsibleAttorney,
      parties,
      openedAt: now.toISOString(),
    };
    this.data.matters.push(matter);
    return clone(matter);
  }

  async listTasks(matterId: string, ctx: CallContext): Promise<Task[]> {
    const matter = await this.getMatter(matterId, ctx);
    return this.data.tasks.filter((t) => t.matterId === matter.id).map(clone);
  }

  async createTask(input: CreateTaskInput, ctx: CallContext): Promise<Task> {
    const matter = await this.requireOpenMatter(input.matterId, ctx);
    const task: Task = {
      id: this.nextId("tk", this.data.tasks),
      matterId: matter.id,
      title: input.title.trim(),
      status: "open",
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.assignee ? { assignee: input.assignee } : {}),
      createdAt: this.now().toISOString(),
    };
    this.data.tasks.push(task);
    return clone(task);
  }

  async listTimeEntries(matterId: string, ctx: CallContext): Promise<TimeEntry[]> {
    const matter = await this.getMatter(matterId, ctx);
    return this.data.timeEntries.filter((t) => t.matterId === matter.id).map(clone);
  }

  async createTimeEntry(input: CreateTimeEntryInput, ctx: CallContext): Promise<TimeEntry> {
    const matter = await this.requireOpenMatter(input.matterId, ctx);
    const entry: TimeEntry = {
      id: this.nextId("te", this.data.timeEntries),
      matterId: matter.id,
      date: input.date,
      hours: input.hours,
      description: input.description.trim(),
      billable: input.billable,
      timekeeper: input.timekeeper,
      createdAt: this.now().toISOString(),
    };
    this.data.timeEntries.push(entry);
    return clone(entry);
  }

  async listDocuments(matterId: string, ctx: CallContext): Promise<DocumentMeta[]> {
    const matter = await this.getMatter(matterId, ctx);
    return this.data.documents.filter((d) => d.matterId === matter.id).map(clone);
  }

  findConflictCandidates(_names: string[], _ctx: CallContext): Promise<ConflictRecord[]> {
    const fromContacts: ConflictRecord[] = this.data.contacts.map((c) => ({
      name: c.name,
      source: "contact",
      contactId: c.id,
    }));
    const fromParties: ConflictRecord[] = this.data.matters.flatMap((m) =>
      m.parties.map((p) => ({
        name: p.name,
        source: "matter_party" as const,
        role: p.role,
        matterId: m.id,
        matterNumber: m.number,
      })),
    );
    return Promise.resolve([...fromContacts, ...fromParties]);
  }

  private async requireOpenMatter(idOrNumber: string, ctx: CallContext): Promise<Matter> {
    const matter = await this.getMatter(idOrNumber, ctx);
    if (matter.status === "closed") {
      throw new AppError("CONFLICT", `Matter ${matter.number} is closed; reopen it before adding work.`, {
        matterId: matter.id,
      });
    }
    return matter;
  }

  private nextId(prefix: string, rows: { id: string }[]): string {
    const max = rows.reduce((acc, r) => Math.max(acc, Number(r.id.split("_")[1] ?? 0)), 0);
    return `${prefix}_${String(max + 1).padStart(4, "0")}`;
  }
}

const clone = <T>(v: T): T => structuredClone(v);
