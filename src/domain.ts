/**
 * Vendor-neutral domain model for a professional-services practice.
 *
 * Adapters translate between these shapes and whatever the upstream
 * practice-management API returns, so tools never depend on a vendor schema.
 */

export type ContactType = "person" | "company";

export interface Contact {
  id: string;
  type: ContactType;
  name: string;
  email?: string;
  phone?: string;
  createdAt: string;
}

export type MatterStatus = "open" | "pending" | "closed";

export type PartyRole = "client" | "opposing_party" | "opposing_counsel" | "related_party";

export interface MatterParty {
  name: string;
  role: PartyRole;
}

export interface Matter {
  id: string;
  /** Human-friendly reference, e.g. "2026-0007". */
  number: string;
  title: string;
  clientId: string;
  status: MatterStatus;
  practiceArea: string;
  responsibleAttorney: string;
  parties: MatterParty[];
  openedAt: string;
}

export type TaskStatus = "open" | "done";

export interface Task {
  id: string;
  matterId: string;
  title: string;
  status: TaskStatus;
  dueDate?: string;
  assignee?: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  matterId: string;
  /** ISO date (YYYY-MM-DD) the work was performed. */
  date: string;
  hours: number;
  description: string;
  billable: boolean;
  timekeeper: string;
  createdAt: string;
}

/** Document metadata only — file contents never flow through this server. */
export interface DocumentMeta {
  id: string;
  matterId: string;
  name: string;
  category: "pleading" | "correspondence" | "contract" | "evidence" | "other";
  sizeBytes: number;
  uploadedAt: string;
}

/** A name that participates in conflict checks (a contact or a matter party). */
export interface ConflictRecord {
  name: string;
  source: "contact" | "matter_party";
  role?: PartyRole;
  contactId?: string;
  matterId?: string;
  matterNumber?: string;
}

// ----- Inputs -------------------------------------------------------------

export interface CreateContactInput {
  type: ContactType;
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
}

export interface MatterFilter {
  status?: MatterStatus | undefined;
  clientId?: string | undefined;
  practiceArea?: string | undefined;
  limit?: number | undefined;
}

export interface CreateMatterInput {
  clientId: string;
  title: string;
  practiceArea: string;
  responsibleAttorney: string;
  parties: MatterParty[];
}

export interface CreateTaskInput {
  matterId: string;
  title: string;
  dueDate?: string | undefined;
  assignee?: string | undefined;
}

export interface CreateTimeEntryInput {
  matterId: string;
  date: string;
  hours: number;
  description: string;
  billable: boolean;
  timekeeper: string;
}
