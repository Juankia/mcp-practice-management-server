import type { ConflictRecord } from "../domain.js";
import { scoreNames, type NameScore } from "./fuzzy.js";

export interface ConflictHit extends ConflictRecord {
  matchedName: string;
  score: number;
  reason: NameScore["reason"];
  /** Adverse hits (opposing party/counsel) are the ones that usually block intake. */
  severity: "high" | "review";
}

export interface ConflictReport {
  checkedNames: string[];
  threshold: number;
  status: "clear" | "potential_conflict";
  hits: ConflictHit[];
  disclaimer: string;
}

const ADVERSE_ROLES = new Set(["opposing_party", "opposing_counsel"]);

export function runConflictCheck(
  names: string[],
  candidates: ConflictRecord[],
  threshold: number,
  maxHits = 50,
): ConflictReport {
  const hits: ConflictHit[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    for (const candidate of candidates) {
      const { score, reason } = scoreNames(name, candidate.name);
      if (score < threshold) continue;
      const dedupeKey = `${name}|${candidate.source}|${candidate.contactId ?? ""}|${candidate.matterId ?? ""}|${candidate.name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      hits.push({
        ...candidate,
        matchedName: name,
        score,
        reason,
        severity: candidate.role !== undefined && ADVERSE_ROLES.has(candidate.role) ? "high" : "review",
      });
    }
  }

  hits.sort((a, b) => (a.severity === b.severity ? b.score - a.score : a.severity === "high" ? -1 : 1));

  return {
    checkedNames: names,
    threshold,
    status: hits.length > 0 ? "potential_conflict" : "clear",
    hits: hits.slice(0, maxHits),
    disclaimer:
      "Automated fuzzy screening only. A responsible professional must review every hit before accepting the engagement.",
  };
}
