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

/** Per-call context passed down from the tool layer. */
export interface CallContext {
  /** Correlates audit-log lines with upstream requests. */
  requestId: string;
  /** Forwarded to upstream APIs that support idempotent POSTs. */
  idempotencyKey?: string;
}

/**
 * The single seam between MCP tools and a practice-management backend.
 *
 * Implementations own authentication, pagination, retries and vendor
 * field-mapping. Tools only ever see the vendor-neutral domain model and
 * never handle credentials.
 */
export interface PracticeManagementAdapter {
  readonly name: string;

  searchContacts(query: string, limit: number, ctx: CallContext): Promise<Contact[]>;
  getContact(id: string, ctx: CallContext): Promise<Contact>;
  createContact(input: CreateContactInput, ctx: CallContext): Promise<Contact>;

  listMatters(filter: MatterFilter, ctx: CallContext): Promise<Matter[]>;
  /** Accepts either the internal id or the human-friendly matter number. */
  getMatter(idOrNumber: string, ctx: CallContext): Promise<Matter>;
  createMatter(input: CreateMatterInput, ctx: CallContext): Promise<Matter>;

  listTasks(matterId: string, ctx: CallContext): Promise<Task[]>;
  createTask(input: CreateTaskInput, ctx: CallContext): Promise<Task>;

  listTimeEntries(matterId: string, ctx: CallContext): Promise<TimeEntry[]>;
  createTimeEntry(input: CreateTimeEntryInput, ctx: CallContext): Promise<TimeEntry>;

  listDocuments(matterId: string, ctx: CallContext): Promise<DocumentMeta[]>;

  /**
   * Returns candidate records for a conflict check. Backends with server-side
   * search should pre-filter by `names`; the fuzzy scoring happens in core.
   */
  findConflictCandidates(names: string[], ctx: CallContext): Promise<ConflictRecord[]>;
}
