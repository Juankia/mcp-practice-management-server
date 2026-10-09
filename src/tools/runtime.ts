import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CallContext, PracticeManagementAdapter } from "../adapters/adapter.js";
import { toAppError } from "../core/errors.js";
import { fingerprint, type IdempotencyStore } from "../core/idempotency.js";
import type { Logger } from "../core/logger.js";

export interface ToolDeps {
  adapter: PracticeManagementAdapter;
  logger: Logger;
  idempotency: IdempotencyStore;
}

export type ToolKind = "read" | "write";
type Outcome = "success" | "preview" | "replayed" | "error";

interface HandlerResult {
  data: Record<string, unknown>;
  outcome?: Outcome;
}

export function toResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/**
 * Wraps a tool handler with:
 *  - a per-call request id (propagated to the adapter / upstream)
 *  - one structured audit-log line per call (tool, outcome, duration, error code)
 *  - consistent, model-safe error mapping (`isError: true` + stable error code)
 */
export function auditedTool<A extends Record<string, unknown>>(
  tool: string,
  kind: ToolKind,
  deps: ToolDeps,
  handler: (args: A, ctx: CallContext) => Promise<HandlerResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    const requestId = randomUUID();
    const started = performance.now();
    const audit = deps.logger.child({ event: "tool_call", tool, kind, requestId, adapter: deps.adapter.name });

    try {
      const { data, outcome = "success" } = await handler(args, { requestId });
      audit.info({ outcome, durationMs: elapsed(started), args }, `tool ${tool} ${outcome}`);
      return toResult(data);
    } catch (err) {
      const appErr = toAppError(err);
      const level = appErr.code === "INTERNAL_ERROR" || appErr.code === "UNAUTHORIZED" ? "error" : "warn";
      audit[level](
        { outcome: "error", durationMs: elapsed(started), args, errorCode: appErr.code, err: appErr.cause ?? appErr },
        `tool ${tool} failed: ${appErr.code}`,
      );
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: {
                  code: appErr.code,
                  message: appErr.message,
                  retryable: appErr.retryable,
                  ...(appErr.details ? { details: appErr.details } : {}),
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  };
}

export interface GuardedWriteSpec<P, R> {
  tool: string;
  /** Payload that will be written (also the idempotency fingerprint input). */
  payload: P;
  confirm: boolean;
  idempotencyKey: string | undefined;
  /** Human-readable summary shown to the user before they approve. */
  summary: string;
  /** Read-only validation run before previewing or committing (e.g. "does the matter exist?"). */
  validate?: (ctx: CallContext) => Promise<Record<string, unknown> | undefined>;
  commit: (ctx: CallContext) => Promise<R>;
  deps: ToolDeps;
  ctx: CallContext;
}

/**
 * Human-in-the-loop write protocol.
 *
 * 1. `confirm` absent/false -> validate, return a preview, change nothing.
 * 2. `confirm: true`        -> validate again, then commit exactly once per
 *    idempotency key (explicit, or derived from the payload when omitted).
 */
export async function guardedWrite<P, R>(spec: GuardedWriteSpec<P, R>): Promise<HandlerResult> {
  const idempotencyKey = spec.idempotencyKey ?? `auto-${fingerprint(spec.tool, spec.payload).slice(0, 32)}`;
  const context = await spec.validate?.(spec.ctx);

  if (!spec.confirm) {
    return {
      outcome: "preview",
      data: {
        status: "preview",
        summary: spec.summary,
        wouldWrite: spec.payload,
        ...(context ? { context } : {}),
        idempotencyKey,
        nextStep: `Nothing has been saved. Show this preview to the user and ask for explicit approval. If approved, call ${spec.tool} again with the same arguments plus "confirm": true and "idempotencyKey": "${idempotencyKey}".`,
      },
    };
  }

  const { value, replayed } = await spec.deps.idempotency.run(spec.tool, idempotencyKey, spec.payload, () =>
    spec.commit({ ...spec.ctx, idempotencyKey }),
  );
  return {
    outcome: replayed ? "replayed" : "success",
    data: {
      status: replayed ? "already_created" : "created",
      idempotencyKey,
      record: value,
      ...(replayed ? { note: "This request was already processed; returning the original record without writing again." } : {}),
    },
  };
}

const elapsed = (start: number): number => Math.round((performance.now() - start) * 100) / 100;
