import { describe, expect, it, vi } from "vitest";
import { ClientCredentialsTokenProvider } from "../src/adapters/oauth.js";
import { RestPracticeAdapter } from "../src/adapters/rest-adapter.js";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const tokenUrl = "https://auth.example.test/oauth/token";
const baseUrl = "https://api.example.test/v1";

describe("ClientCredentialsTokenProvider", () => {
  it("requests a token with basic auth and caches it until shortly before expiry", async () => {
    let now = 0;
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(json(200, { access_token: `tok-${fetchMock.mock.calls.length}`, expires_in: 3600 })),
    );
    const provider = new ClientCredentialsTokenProvider({
      tokenUrl,
      clientId: "client-id",
      clientSecret: "s3cret",
      scope: "matters",
      fetch: fetchMock,
      now: () => now,
    });

    expect(await provider.getAccessToken()).toBe("tok-1");
    expect(await provider.getAccessToken()).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("client-id:s3cret").toString("base64")}`);
    expect((init?.body as URLSearchParams).toString()).toBe("grant_type=client_credentials&scope=matters");

    now = (3600 - 30) * 1000; // inside the 60s refresh skew
    expect(await provider.getAccessToken()).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares a single in-flight refresh between concurrent callers", async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>((r) => setTimeout(() => { r(json(200, { access_token: "t", expires_in: 60 * 60 })); }, 5)),
    );
    const provider = new ClientCredentialsTokenProvider({
      tokenUrl,
      clientId: "a",
      clientSecret: "b",
      fetch: fetchMock,
    });
    await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a rejected client to UNAUTHORIZED without leaking the response body", async () => {
    const provider = new ClientCredentialsTokenProvider({
      tokenUrl,
      clientId: "a",
      clientSecret: "wrong",
      fetch: (() => Promise.resolve(json(401, { error: "invalid_client", secret_echo: "wrong" }))),
    });
    const err = await provider.getAccessToken().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "UNAUTHORIZED" });
    expect(JSON.stringify(err)).not.toContain("wrong");
  });
});

describe("RestPracticeAdapter", () => {
  const makeTokens = () => {
    let n = 0;
    return {
      getAccessToken: vi.fn(() => Promise.resolve(`token-${String(n)}`)),
      invalidate: vi.fn(() => {
        n++;
      }),
    };
  };

  it("sends bearer token, request id and query params; unwraps data envelopes", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(json(200, { data: [{ id: "mt_1" }] })),
    );
    const adapter = new RestPracticeAdapter({ baseUrl: `${baseUrl}/`, tokens: makeTokens(), fetch: fetchMock });

    const matters = await adapter.listMatters({ status: "open", limit: 5 }, { requestId: "req-1" });

    expect(matters).toEqual([{ id: "mt_1" }]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect((url as URL).href).toBe(`${baseUrl}/matters?status=open&limit=5`);
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-0");
    expect(headers["x-request-id"]).toBe("req-1");
  });

  it("forwards the idempotency key on writes", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) => Promise.resolve(json(201, { id: "ct_9" })));
    const adapter = new RestPracticeAdapter({ baseUrl, tokens: makeTokens(), fetch: fetchMock });

    await adapter.createContact({ type: "person", name: "Ada Quill" }, { requestId: "r", idempotencyKey: "idem-123456" });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["idempotency-key"]).toBe("idem-123456");
    expect(JSON.parse(init?.body as string)).toEqual({ type: "person", name: "Ada Quill" });
  });

  it("refreshes the token once on 401 and retries", async () => {
    const tokens = makeTokens();
    const fetchMock = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { id: "ct_1", name: "X" }));
    const adapter = new RestPracticeAdapter({ baseUrl, tokens, fetch: fetchMock });

    await expect(adapter.getContact("ct_1", { requestId: "r" })).resolves.toMatchObject({ id: "ct_1" });
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
    const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders.authorization).toBe("Bearer token-1");
  });

  it.each([
    [404, "NOT_FOUND", false],
    [409, "CONFLICT", false],
    [422, "VALIDATION_ERROR", false],
    [429, "RATE_LIMITED", true],
    [503, "UPSTREAM_UNAVAILABLE", true],
  ])("maps HTTP %i to %s (retryable=%s)", async (status, code, retryable) => {
    const adapter = new RestPracticeAdapter({
      baseUrl,
      tokens: makeTokens(),
      fetch: (() => Promise.resolve(json(status, { internal: "stack trace" }))),
    });
    await expect(adapter.getMatter("mt_1", { requestId: "r" })).rejects.toMatchObject({ code, retryable });
  });

  it("maps network failures to UPSTREAM_UNAVAILABLE", async () => {
    const adapter = new RestPracticeAdapter({
      baseUrl,
      tokens: makeTokens(),
      fetch: (() => Promise.reject(new TypeError("fetch failed"))),
    });
    await expect(adapter.listDocuments("mt_1", { requestId: "r" })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});
