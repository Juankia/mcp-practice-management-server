import { describe, expect, it } from "vitest";
import { runConflictCheck } from "../src/core/conflicts.js";
import { jaroWinkler, normalizeName, scoreNames } from "../src/core/fuzzy.js";
import type { ConflictRecord } from "../src/domain.js";

describe("normalizeName", () => {
  it("strips accents, punctuation, entity suffixes and honorifics", () => {
    expect(normalizeName("Sofía Valdivieso")).toEqual(["sofia", "valdivieso"]);
    expect(normalizeName("Cedar Ridge Dental Group, Inc.")).toEqual(["cedar", "ridge", "dental", "group"]);
    expect(normalizeName("Dr. Dana Kessler, Esq.")).toEqual(["dana", "kessler"]);
  });
});

describe("jaroWinkler", () => {
  it("returns 1 for identical and 0 for disjoint strings", () => {
    expect(jaroWinkler("kessler", "kessler")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("", "abc")).toBe(0);
  });

  it("matches the classic reference value", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
  });
});

describe("scoreNames", () => {
  it.each([
    ["Harlow Property Management", "Harlow Property Management LLC", "exact"],
    ["Kessler, Dana", "Dana Kessler", "exact"],
    ["Dana Kesler", "Dana Kessler", "similar"],
    ["Bluefin", "Bluefin Logistics LLC", "token_overlap"],
  ])("flags %s ~ %s", (a, b, reason) => {
    const s = scoreNames(a, b);
    expect(s.score).toBeGreaterThanOrEqual(0.88);
    expect(s.reason).toBe(reason);
  });

  it("does not flag unrelated names", () => {
    expect(scoreNames("John Smith", "John Doe").score).toBeLessThan(0.88);
    expect(scoreNames("Granite Peak Builders", "Silverline Developments").score).toBeLessThan(0.88);
  });
});

describe("runConflictCheck", () => {
  const candidates: ConflictRecord[] = [
    { name: "Dana Kessler", source: "matter_party", role: "opposing_party", matterId: "mt_1", matterNumber: "2026-0004" },
    { name: "Dana Kessler", source: "contact", contactId: "ct_9" },
    { name: "Eleanor Whitfield", source: "contact", contactId: "ct_1" },
  ];

  it("returns clear when nothing matches", () => {
    const r = runConflictCheck(["Completely Unrelated Person"], candidates, 0.88);
    expect(r.status).toBe("clear");
    expect(r.hits).toHaveLength(0);
  });

  it("ranks adverse-party hits first as high severity", () => {
    const r = runConflictCheck(["Dana Kesler"], candidates, 0.88);
    expect(r.status).toBe("potential_conflict");
    expect(r.hits[0]).toMatchObject({ severity: "high", role: "opposing_party", matterNumber: "2026-0004" });
    expect(r.hits[1]).toMatchObject({ severity: "review", source: "contact" });
  });
});
