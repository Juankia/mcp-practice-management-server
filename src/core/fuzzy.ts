/**
 * Name matching for conflict-of-interest checks.
 *
 * Conflict checks must favour recall over precision: a missed conflict is a
 * professional-responsibility problem, a false positive costs a human a few
 * seconds of review. The scorer therefore combines:
 *   1. normalization (case, accents, punctuation, entity suffixes, honorifics)
 *   2. Jaro-Winkler similarity on the normalized and token-sorted forms
 *      (catches typos and "Last, First" ordering)
 *   3. token containment (catches "Acme" vs "Acme Logistics Holdings")
 */

const ENTITY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation",
  "co", "company", "plc", "gmbh", "sa", "sas", "pllc", "pc", "the",
]);
const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "jr", "sr", "esq", "ii", "iii"]);

export function normalizeName(raw: string): string[] {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !ENTITY_SUFFIXES.has(t) && !HONORIFICS.has(t));
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export interface NameScore {
  score: number;
  reason: "exact" | "similar" | "token_overlap";
}

export function scoreNames(query: string, candidate: string): NameScore {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (q.length === 0 || c.length === 0) return { score: 0, reason: "similar" };

  const qJoined = q.join(" ");
  const cJoined = c.join(" ");
  if (qJoined === cJoined) return { score: 1, reason: "exact" };

  const sortedQ = [...q].sort().join(" ");
  const sortedC = [...c].sort().join(" ");
  if (sortedQ === sortedC) return { score: 0.98, reason: "exact" };

  const similarity = Math.max(jaroWinkler(qJoined, cJoined), jaroWinkler(sortedQ, sortedC));

  // Token containment: every token of the shorter name appears (fuzzily) in the longer one.
  const [shorter, longer] = q.length <= c.length ? [q, c] : [c, q];
  const contained = shorter.every((t) => longer.some((u) => u === t || (t.length >= 4 && jaroWinkler(t, u) >= 0.92)));
  const distinctive = shorter.join("").length >= 4;
  const overlap = contained && distinctive ? 0.9 : 0;

  return overlap > similarity
    ? { score: round(overlap), reason: "token_overlap" }
    : { score: round(similarity), reason: "similar" };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
