import type { Contact, DocumentMeta, Matter, Task, TimeEntry } from "../domain.js";

/**
 * Entirely fictional sample data for a small professional-services firm.
 * Any resemblance to real people or organizations is coincidental.
 */
export interface SeedData {
  contacts: Contact[];
  matters: Matter[];
  tasks: Task[];
  timeEntries: TimeEntry[];
  documents: DocumentMeta[];
}

export function createSeedData(): SeedData {
  const contacts: Contact[] = [
    { id: "ct_0001", type: "person", name: "Eleanor Whitfield", email: "eleanor.whitfield@example.com", phone: "+1-555-0101", createdAt: "2025-11-03T15:00:00.000Z" },
    { id: "ct_0002", type: "company", name: "Bluefin Logistics LLC", email: "legal@bluefin-logistics.example", phone: "+1-555-0102", createdAt: "2025-12-12T15:00:00.000Z" },
    { id: "ct_0003", type: "person", name: "Marcus Oyelaran", email: "m.oyelaran@example.com", createdAt: "2026-01-08T15:00:00.000Z" },
    { id: "ct_0004", type: "company", name: "Cedar Ridge Dental Group, Inc.", email: "office@cedarridge.example", phone: "+1-555-0104", createdAt: "2026-02-19T15:00:00.000Z" },
    { id: "ct_0005", type: "person", name: "Sofía Valdivieso", email: "sofia.v@example.com", phone: "+1-555-0105", createdAt: "2026-03-02T15:00:00.000Z" },
    { id: "ct_0006", type: "company", name: "Granite Peak Builders Corp", email: "contracts@granitepeak.example", createdAt: "2026-04-21T15:00:00.000Z" },
    { id: "ct_0007", type: "person", name: "Theodore Brannigan", phone: "+1-555-0107", createdAt: "2026-05-30T15:00:00.000Z" },
  ];

  const matters: Matter[] = [
    {
      id: "mt_0001", number: "2026-0001", title: "Whitfield v. Harlow Property Management", clientId: "ct_0001",
      status: "open", practiceArea: "Real Estate Litigation", responsibleAttorney: "A. Reyes",
      parties: [
        { name: "Eleanor Whitfield", role: "client" },
        { name: "Harlow Property Management LLC", role: "opposing_party" },
        { name: "Dunmore & Pratt LLP", role: "opposing_counsel" },
      ],
      openedAt: "2026-01-10T14:00:00.000Z",
    },
    {
      id: "mt_0002", number: "2026-0002", title: "Bluefin Logistics — Master Services Agreement Review", clientId: "ct_0002",
      status: "open", practiceArea: "Commercial Contracts", responsibleAttorney: "J. Castillo",
      parties: [
        { name: "Bluefin Logistics LLC", role: "client" },
        { name: "Northgate Freight Systems Inc.", role: "related_party" },
      ],
      openedAt: "2026-02-02T14:00:00.000Z",
    },
    {
      id: "mt_0003", number: "2026-0003", title: "Oyelaran Estate Plan", clientId: "ct_0003",
      status: "pending", practiceArea: "Estate Planning", responsibleAttorney: "A. Reyes",
      parties: [{ name: "Marcus Oyelaran", role: "client" }],
      openedAt: "2026-03-15T14:00:00.000Z",
    },
    {
      id: "mt_0004", number: "2026-0004", title: "Cedar Ridge Dental — Employment Dispute (Kessler)", clientId: "ct_0004",
      status: "open", practiceArea: "Employment", responsibleAttorney: "J. Castillo",
      parties: [
        { name: "Cedar Ridge Dental Group, Inc.", role: "client" },
        { name: "Dana Kessler", role: "opposing_party" },
      ],
      openedAt: "2026-04-01T14:00:00.000Z",
    },
    {
      id: "mt_0005", number: "2025-0042", title: "Granite Peak Builders — Lien Enforcement", clientId: "ct_0006",
      status: "closed", practiceArea: "Construction", responsibleAttorney: "M. Lindqvist",
      parties: [
        { name: "Granite Peak Builders Corp", role: "client" },
        { name: "Silverline Developments Ltd", role: "opposing_party" },
      ],
      openedAt: "2025-08-20T14:00:00.000Z",
    },
  ];

  const tasks: Task[] = [
    { id: "tk_0001", matterId: "mt_0001", title: "Draft response to motion to dismiss", status: "open", dueDate: "2026-10-20", assignee: "A. Reyes", createdAt: "2026-09-28T13:00:00.000Z" },
    { id: "tk_0002", matterId: "mt_0001", title: "Collect lease correspondence from client", status: "done", assignee: "P. Moreno", createdAt: "2026-09-01T13:00:00.000Z" },
    { id: "tk_0003", matterId: "mt_0002", title: "Redline limitation-of-liability clause", status: "open", dueDate: "2026-10-14", assignee: "J. Castillo", createdAt: "2026-09-30T13:00:00.000Z" },
    { id: "tk_0004", matterId: "mt_0004", title: "Prepare mediation statement", status: "open", dueDate: "2026-11-05", assignee: "J. Castillo", createdAt: "2026-10-01T13:00:00.000Z" },
  ];

  const timeEntries: TimeEntry[] = [
    { id: "te_0001", matterId: "mt_0001", date: "2026-09-29", hours: 2.5, description: "Research on habitability standards", billable: true, timekeeper: "A. Reyes", createdAt: "2026-09-29T22:00:00.000Z" },
    { id: "te_0002", matterId: "mt_0001", date: "2026-09-30", hours: 1.2, description: "Client call re: lease timeline", billable: true, timekeeper: "A. Reyes", createdAt: "2026-09-30T22:00:00.000Z" },
    { id: "te_0003", matterId: "mt_0002", date: "2026-10-01", hours: 3.0, description: "First-pass MSA review", billable: true, timekeeper: "J. Castillo", createdAt: "2026-10-01T22:00:00.000Z" },
    { id: "te_0004", matterId: "mt_0004", date: "2026-10-02", hours: 0.4, description: "Internal conflict review", billable: false, timekeeper: "J. Castillo", createdAt: "2026-10-02T22:00:00.000Z" },
  ];

  const documents: DocumentMeta[] = [
    { id: "doc_0001", matterId: "mt_0001", name: "Complaint (filed).pdf", category: "pleading", sizeBytes: 482_113, uploadedAt: "2026-01-12T16:00:00.000Z" },
    { id: "doc_0002", matterId: "mt_0001", name: "Lease agreement 2023.pdf", category: "evidence", sizeBytes: 1_204_551, uploadedAt: "2026-01-11T16:00:00.000Z" },
    { id: "doc_0003", matterId: "mt_0002", name: "MSA draft v3.docx", category: "contract", sizeBytes: 88_204, uploadedAt: "2026-10-01T16:00:00.000Z" },
    { id: "doc_0004", matterId: "mt_0004", name: "Demand letter from claimant.pdf", category: "correspondence", sizeBytes: 152_009, uploadedAt: "2026-04-02T16:00:00.000Z" },
  ];

  return { contacts, matters, tasks, timeEntries, documents };
}
