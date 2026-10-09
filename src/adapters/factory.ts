import type { AppConfig } from "../config.js";
import type { Logger } from "../core/logger.js";
import type { PracticeManagementAdapter } from "./adapter.js";
import { InMemoryPracticeAdapter } from "./memory-adapter.js";
import { ClientCredentialsTokenProvider } from "./oauth.js";
import { RestPracticeAdapter } from "./rest-adapter.js";

export function createAdapter(config: AppConfig, logger: Logger): PracticeManagementAdapter {
  if (config.PM_ADAPTER === "memory") return new InMemoryPracticeAdapter();

  // loadConfig() guarantees these are present when PM_ADAPTER=rest.
  const tokens = new ClientCredentialsTokenProvider({
    tokenUrl: config.PM_OAUTH_TOKEN_URL ?? "",
    clientId: config.PM_OAUTH_CLIENT_ID ?? "",
    clientSecret: config.PM_OAUTH_CLIENT_SECRET ?? "",
    scope: config.PM_OAUTH_SCOPE,
  });
  return new RestPracticeAdapter({
    baseUrl: config.PM_API_BASE_URL ?? "",
    tokens,
    timeoutMs: config.PM_HTTP_TIMEOUT_MS,
    logger: logger.child({ component: "rest-adapter" }),
  });
}
