import { AppError } from "../core/errors.js";

export interface ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string | undefined;
  /** Refresh this many ms before the token actually expires. */
  expirySkewMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
}

/**
 * OAuth 2.0 client-credentials token provider.
 *
 * - Tokens are cached in memory and refreshed shortly before expiry.
 * - Concurrent callers share a single in-flight refresh (no thundering herd).
 * - `invalidate()` lets the HTTP layer force a refresh after a 401.
 * - The secret and token live only in this process; they are never returned
 *   to tools, logged, or sent to the model.
 */
export class ClientCredentialsTokenProvider {
  private cached: CachedToken | undefined;
  private inflight: Promise<CachedToken> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly skew: number;

  constructor(private readonly cfg: ClientCredentialsConfig) {
    this.fetchImpl = cfg.fetch ?? fetch;
    this.now = cfg.now ?? Date.now;
    this.skew = cfg.expirySkewMs ?? 60_000;
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - this.skew > this.now()) {
      return this.cached.accessToken;
    }
    this.inflight ??= this.requestToken().finally(() => {
      this.inflight = undefined;
    });
    this.cached = await this.inflight;
    return this.cached.accessToken;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async requestToken(): Promise<CachedToken> {
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.cfg.scope) body.set("scope", this.cfg.scope);
    const basic = Buffer.from(
      `${encodeURIComponent(this.cfg.clientId)}:${encodeURIComponent(this.cfg.clientSecret)}`,
    ).toString("base64");

    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.tokenUrl, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "Could not reach the authorization server.", undefined, { cause: err });
    }

    if (!res.ok) {
      throw res.status >= 500
        ? new AppError("UPSTREAM_UNAVAILABLE", "Authorization server unavailable.")
        : new AppError("UNAUTHORIZED", "The server's integration credentials were rejected by the authorization server.");
    }

    const json = (await res.json()) as TokenResponse;
    if (typeof json.access_token !== "string" || json.access_token.length === 0) {
      throw new AppError("UNAUTHORIZED", "Authorization server returned no access token.");
    }
    const expiresInSec = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 300;
    return { accessToken: json.access_token, expiresAt: this.now() + expiresInSec * 1000 };
  }
}
