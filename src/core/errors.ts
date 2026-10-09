/**
 * A small, closed set of error codes the model can reason about.
 * Upstream details (status bodies, stack traces, tokens) never leak past here.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR";

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["RATE_LIMITED", "UPSTREAM_UNAVAILABLE"]);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.details = details;
  }
}

export const notFound = (entity: string, id: string): AppError =>
  new AppError("NOT_FOUND", `${entity} '${id}' was not found.`, { entity, id });

/** Map an upstream HTTP status to a model-safe error. */
export function fromHttpStatus(status: number, context: string): AppError {
  if (status === 400 || status === 422) return new AppError("VALIDATION_ERROR", `${context}: upstream rejected the request.`);
  if (status === 401 || status === 403) return new AppError("UNAUTHORIZED", `${context}: the server's integration credentials were rejected.`);
  if (status === 404) return new AppError("NOT_FOUND", `${context}: resource not found.`);
  if (status === 409) return new AppError("CONFLICT", `${context}: the resource changed or already exists.`);
  if (status === 429) return new AppError("RATE_LIMITED", `${context}: upstream rate limit reached, retry later.`);
  if (status >= 500) return new AppError("UPSTREAM_UNAVAILABLE", `${context}: upstream service unavailable.`);
  return new AppError("INTERNAL_ERROR", `${context}: unexpected upstream status ${status}.`);
}

/** Normalize anything thrown into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new AppError("UPSTREAM_UNAVAILABLE", "Upstream request timed out.", undefined, { cause: err });
  }
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", undefined, { cause: err });
}
