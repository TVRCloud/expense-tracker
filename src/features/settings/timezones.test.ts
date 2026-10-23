import { describe, expect, it } from "vitest";
import { timeZoneOptions } from "@/features/settings/timezones";
import { isValidTimeZone } from "@/lib/spend-limit-time";

describe("timeZoneOptions", () => {
  it("only offers zones the server accepts, sorted, with the default included", () => {
    const zones = timeZoneOptions();
    expect(zones.length).toBeGreaterThan(5);
    expect(zones).toContain("Asia/Kolkata");
    expect(zones.every(isValidTimeZone)).toBe(true);
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });
  it("keeps a saved zone and ignores an invalid one", () => {
    expect(timeZoneOptions("America/New_York")).toContain("America/New_York");
    expect(timeZoneOptions("Nowhere/Land")).not.toContain("Nowhere/Land");
  });
});
