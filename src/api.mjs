import { loadKey } from "./credentials.mjs";

export const DEFAULT_ORIGIN = "https://open-interaction.fly.dev";
export class UsageError extends Error {}
export class ApiError extends Error {
  constructor(code, message, { status, requestId } = {}) {
    super(`${code}: ${message}${requestId ? ` (request ${requestId})` : ""}`);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function apiOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new UsageError("RECURRENCE_API_ORIGIN must be a valid URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new UsageError("RECURRENCE_API_ORIGIN must be an HTTPS origin (HTTP is allowed for localhost only).");
  }
  return url.origin;
}

export function validateIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128 || /\s/.test(value)) {
    throw new UsageError("Idempotency key must be 8–128 characters without whitespace.");
  }
}

export function createApiClient({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const origin = apiOrigin(env.RECURRENCE_API_ORIGIN || DEFAULT_ORIGIN);
  async function request(path, { authenticated = true, payload, idempotencyKey } = {}) {
    const key = authenticated ? env.RECURRENCE_API_KEY?.trim() || await loadKey(env) : undefined;
    if (authenticated && !key) throw new UsageError("Run recurrence auth login or set RECURRENCE_API_KEY.");
    const redact = (value) => key ? String(value).replaceAll(key, "[REDACTED]") : String(value);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body && Buffer.byteLength(body, "utf8") > 128 * 1024) throw new UsageError("Decision JSON must be at most 128 KiB.");
    let response;
    try {
      response = await fetcher(`${origin}${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(body ? 120_000 : 20_000),
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(body ? { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey } : {}) },
        ...(body ? { body } : {}),
      });
    } catch (error) {
      throw new ApiError("NETWORK_ERROR", redact(error.message));
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(redact(result?.error?.code ?? `HTTP_${response.status}`),
        redact(result?.error?.message ?? `Request failed with HTTP ${response.status}`),
        { status: response.status, requestId: redact(response.headers.get("x-decision-request-id") ?? result?.error?.requestId ?? "") || undefined });
    }
    if (result === null) throw new ApiError("INVALID_RESPONSE", "API returned invalid JSON.");
    return result;
  }
  return {
    models: () => request("/v1/models", { authenticated: false }),
    balance: () => request("/v1/billing/preview"),
    activity: (limit = 20) => request(`/v1/decisions?limit=${limit}`),
    status: (requestId) => request(`/v1/decisions/${encodeURIComponent(requestId)}`),
    decide: (payload, idempotencyKey) => {
      validateIdempotencyKey(idempotencyKey);
      return request("/v1/decisions", { payload, idempotencyKey });
    },
  };
}
