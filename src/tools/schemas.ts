import { z } from "zod";

export const confirmField = z
  .boolean()
  .default(false)
  .describe(
    "Human-in-the-loop gate. Omit or false to get a dry-run preview (nothing is written). Set true ONLY after the user has explicitly approved the preview.",
  );

export const idempotencyKeyField = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits, '.', '_', ':' or '-'")
  .optional()
  .describe(
    "Optional client-supplied key that makes this create safe to retry. Reuse the key returned by the preview. If omitted, one is derived from the payload.",
  );

export const matterRefField = z
  .string()
  .min(1)
  .max(64)
  .describe("Matter id (e.g. 'mt_0001') or matter number (e.g. '2026-0001').");

export const isoDateField = z.iso.date().describe("ISO date, YYYY-MM-DD.");

export const partyRoleField = z.enum(["client", "opposing_party", "opposing_counsel", "related_party"]);
