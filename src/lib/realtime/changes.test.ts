import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { buildPipeline, collectionToResource, RESOURCES, RESOURCE_NAMES } from "@/lib/realtime/changes";
import { parseSince } from "@/lib/realtime/changed-since";
import { formatSse } from "@/lib/realtime/sse";

describe("collectionToResource", () => {
  it("maps allow-listed collections", () => {
    expect(collectionToResource("transactions")).toBe("transactions");
    expect(collectionToResource("captured_messages")).toBe("captures");
    expect(collectionToResource("notifications")).toBe("notifications");
  });
  it("rejects everything else", () => {
    for (const c of ["users", "api_keys", "ledgerblocks", "", undefined, null, "constructor", "__proto__"]) {
      expect(collectionToResource(c as string)).toBeNull();
    }
  });
  it("maps repayments and credit statements", () => {
    expect(collectionToResource("repayments")).toBe("repayments");
    expect(collectionToResource("credit_statements")).toBe("statements");
  });
  it("covers every resource", () => {
    expect([...RESOURCE_NAMES].sort()).toEqual(
      ["accounts", "budgets", "captures", "goals", "loans", "notifications", "repayments", "statements", "transactions"]
    );
  });
});

describe("buildPipeline", () => {
  const oid = new mongoose.Types.ObjectId();
  const match = buildPipeline(oid)[0].$match;

  it("filters by allow-list and owner", () => {
    expect(match["ns.coll"].$in).toEqual(Object.keys(RESOURCES));
    expect(match["fullDocument.user"]).toBe(oid);
  });
  it("never forwards deletes", () => {
    expect(match.operationType.$in).toEqual(["insert", "update", "replace"]);
    expect(match.operationType.$in).not.toContain("delete");
  });
});

describe("parseSince", () => {
  it("parses epoch ms", () => expect(parseSince("1700000000000")?.getTime()).toBe(1700000000000));
  it("returns null for missing/invalid", () => {
    for (const v of [null, "", "abc", "-5", "0", "1.5", "99999999999999999999"]) expect(parseSince(v)).toBeNull();
  });
});

describe("formatSse", () => {
  it("formats id, event and data", () => {
    expect(formatSse("data-changed", { resource: "goals" }, 3)).toBe(
      'id: 3\nevent: data-changed\ndata: {"resource":"goals"}\n\n'
    );
    expect(formatSse("ping", {})).toBe("event: ping\ndata: {}\n\n");
  });
});
