import type {
  ConflictRecord,
  Contact,
  CreateContactInput,
  CreateMatterInput,
  CreateTaskInput,
  CreateTimeEntryInput,
  DocumentMeta,
  Matter,
  MatterFilter,
  Task,
  TimeEntry,
} from "../domain.js";
import { AppError, fromHttpStatus } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import type { CallContext, PracticeManagementAdapter } from "./adapter.js";
import type { ClientCredentialsTokenProvider } from "./oauth.js";

export interface RestAdapterConfig {
  baseUrl: string;
  tokens: Pick<ClientCredentialsTokenProvider, "getAccessToken" | "invalidate">;
  timeoutMs?: number;
  fetch?: typeof fetch;
  logger?: Logger;
}

type Query = Record<string, string | number | undefined>;

/**
 * REST adapter skeleton for a cloud practice-management API.
 *
 * It assumes a conventional JSON API (`GET /matters?status=open`,
 * `POST /contacts`, `{ "data": ... }` envelopes). Point it at a real vendor
 * by adjusting the paths and the `toDomain*` mappers — the auth, retry,
 * timeout, idempotency and error-mapping plumbing stays the same.
 */
export class RestPracticeAdapter implements PracticeManagementAdapter {
  readonly name = "rest";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: RestAdapterConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = cfg.fetch ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  searchContacts(query: string, limit: number, ctx: CallContext): Promise<Contact[]> {
    return this.request<Contact[]>("GET", "/contacts", ctx, { query: { q: query, limit } });
  }

  getContact(id: string, ctx: CallContext): Promise<Contact> {
    return this.request<Contact>("GET", `/contacts/${encodeURIComponent(id)}`, ctx);
  }

  createContact(input: CreateContactInput, ctx: CallContext): Promise<Contact> {
    return this.request<Contact>("POST", "/contacts", ctx, { body: input });
  }

  listMatters(filter: MatterFilter, ctx: CallContext): Promise<Matter[]> {
    return this.request<Matter[]>("GET", "/matters", ctx, {
      query: {
        status: filter.status,
        client_id: filter.clientId,
        practice_area: filter.practiceArea,
        limit: filter.limit,
      },
    });
  }

  getMatter(idOrNumber: string, ctx: CallContext): Promise<Matter> {
    return this.request<Matter>("GET", `/matters/${encodeURIComponent(idOrNumber)}`, ctx);
  }

  createMatter(input: CreateMatterInput, ctx: CallContext): Promise<Matter> {
    return this.request<Matter>("POST", "/matters", ctx, { body: input });
  }

  listTasks(matterId: string, ctx: CallContext): Promise<Task[]> {
    return this.request<Task[]>("GET", `/matters/${encodeURIComponent(matterId)}/tasks`, ctx);
  }

  createTask(input: CreateTaskInput, ctx: CallContext): Promise<Task> {
    return this.request<Task>("POST", `/matters/${encodeURIComponent(input.matterId)}/tasks`, ctx, { body: input });
  }

  listTimeEntries(matterId: string, ctx: CallContext): Promise<TimeEntry[]> {
    return this.request<TimeEntry[]>("GET", `/matters/${encodeURIComponent(matterId)}/time_entries`, ctx);
  }

  createTimeEntry(input: CreateTimeEntryInput, ctx: CallContext): Promise<TimeEntry> {
    return this.request<TimeEntry>("POST", `/matters/${encodeURIComponent(input.matterId)}/time_entries`, ctx, {
      body: input,
    });
  }

  listDocuments(matterId: string, ctx: CallContext): Promise<DocumentMeta[]> {
    return this.request<DocumentMeta[]>("GET", `/matters/${encodeURIComponent(matterId)}/documents`, ctx);
  }

  async findConflictCandidates(names: string[], ctx: CallContext): Promise<ConflictRecord[]> {
    const pages = await Promise.all(
      names.map((name) => this.request<ConflictRecord[]>("GET", "/conflict_candidates", ctx, { query: { q: name } })),
    );
    return pages.flat();
  }

  /**
   * Authenticated request with: bearer token from the provider, one forced
   * token refresh on 401, request timeout, idempotency header on writes and
   * HTTP-status -> AppError mapping.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    ctx: CallContext,
    opts: { query?: Query; body?: unknown } = {},
    attempt = 0,
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const token = await this.cfg.tokens.getAccessToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": ctx.requestId,
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (method === "POST" && ctx.idempotencyKey) headers["idempotency-key"] = ctx.idempotencyKey;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? null : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new AppError("UPSTREAM_UNAVAILABLE", `${method} ${path}: upstream request failed.`, undefined, {
        cause: err,
      });
    }

    if (res.status === 401 && attempt === 0) {
      this.cfg.logger?.warn({ requestId: ctx.requestId, path }, "upstream returned 401, refreshing token");
      this.cfg.tokens.invalidate();
      return this.request<T>(method, path, ctx, opts, attempt + 1);
    }

    if (!res.ok) {
      this.cfg.logger?.warn({ requestId: ctx.requestId, path, status: res.status }, "upstream error");
      throw fromHttpStatus(res.status, `${method} ${path}`);
    }

    const json = (await res.json()) as { data?: T } | T;
    return json !== null && typeof json === "object" && "data" in json ? (json.data as T) : (json as T);
  }
}
