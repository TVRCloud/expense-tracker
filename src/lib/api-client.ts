import axios from "axios";

const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 60000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const message =
      err.response?.data?.error ?? err.message ?? "Something went wrong";
    // The status and the server's `code` ride on the error so a caller can tell a
    // refusal from a lost answer; callers that only read `message` are unaffected.
    const error = new Error(message) as ApiRequestError;
    error.status = err.response?.status;
    error.code = typeof err.response?.data?.code === "string" ? err.response.data.code : undefined;
    return Promise.reject(error);
  }
);

export type ApiRequestError = Error & { status?: number; code?: string };

/**
 * True when the server answered with a definite refusal that carries its own
 * `code` (a 4xx such as INSUFFICIENT): the request was judged and nothing ran,
 * so a new attempt may use a new Idempotency-Key. False for a timeout or network
 * drop (no status), a 5xx, and IDEMPOTENCY_CONFLICT: there the first request may
 * have run, and a retry must keep its key so it cannot run twice.
 */
export function isDefiniteRefusal(err: unknown): boolean {
  const e = err as ApiRequestError | null;
  return Boolean(e && typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.code && e.code !== "IDEMPOTENCY_CONFLICT");
}

export default apiClient;
