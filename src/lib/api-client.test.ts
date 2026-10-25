import { describe, expect, it } from "vitest";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import apiClient, { isDefiniteRefusal, type ApiRequestError } from "@/lib/api-client";

// Make the shared client fail the way the network or the server would.
async function fail(response?: { status: number; data?: unknown }, message = "boom"): Promise<ApiRequestError> {
  apiClient.defaults.adapter = async (config) => {
    const err = new AxiosError(message, "ERR", config as InternalAxiosRequestConfig, undefined, response && ({ ...response, headers: {}, statusText: "", config } as never));
    throw err;
  };
  try {
    await apiClient.get("/x");
  } catch (e) {
    return e as ApiRequestError;
  }
  throw new Error("expected a failure");
}

describe("api client errors", () => {
  it("keeps the message and adds the status and the server's code", async () => {
    const err = await fail({ status: 400, data: { error: "Food has less assigned", code: "INSUFFICIENT" } });
    expect(err.message).toBe("Food has less assigned");
    expect(err.status).toBe(400);
    expect(err.code).toBe("INSUFFICIENT");
  });

  it("a transport failure has no status or code", async () => {
    const err = await fail(undefined, "timeout of 60000ms exceeded");
    expect(err.message).toBe("timeout of 60000ms exceeded");
    expect(err.status).toBeUndefined();
    expect(err.code).toBeUndefined();
  });

  it("only a definite 4xx refusal with a code may take a new Idempotency-Key", async () => {
    expect(isDefiniteRefusal(await fail({ status: 400, data: { error: "x", code: "INSUFFICIENT" } }))).toBe(true);
    expect(isDefiniteRefusal(await fail({ status: 404, data: { error: "x", code: "ENVELOPE_NOT_FOUND" } }))).toBe(true);
    expect(isDefiniteRefusal(await fail({ status: 409, data: { error: "x", code: "ENVELOPES_DISABLED" } }))).toBe(true);
    // the first request may have run: keep the key
    expect(isDefiniteRefusal(await fail({ status: 409, data: { error: "x", code: "IDEMPOTENCY_CONFLICT" } }))).toBe(false);
    expect(isDefiniteRefusal(await fail({ status: 500, data: { error: "Internal server error" } }))).toBe(false);
    expect(isDefiniteRefusal(await fail({ status: 502, data: { error: "x", code: "INSUFFICIENT" } }))).toBe(false);
    expect(isDefiniteRefusal(await fail({ status: 400, data: { error: "Validation failed" } }))).toBe(false); // no code
    expect(isDefiniteRefusal(await fail(undefined, "Network Error"))).toBe(false);
    expect(isDefiniteRefusal(null)).toBe(false);
  });
});
