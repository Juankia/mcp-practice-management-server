import { z } from "zod";

const EnvSchema = z
  .object({
    PM_ADAPTER: z.enum(["memory", "rest"]).default("memory"),
    PM_API_BASE_URL: z.url().optional(),
    PM_OAUTH_TOKEN_URL: z.url().optional(),
    PM_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    PM_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    PM_OAUTH_SCOPE: z.string().optional(),
    PM_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    MCP_HTTP_HOST: z.string().default("127.0.0.1"),
    MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
    MCP_HTTP_AUTH_TOKEN: z.string().min(16).optional(),

    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.PM_ADAPTER === "rest") {
      for (const key of ["PM_API_BASE_URL", "PM_OAUTH_TOKEN_URL", "PM_OAUTH_CLIENT_ID", "PM_OAUTH_CLIENT_SECRET"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when PM_ADAPTER=rest` });
      }
    }
    if (env.MCP_TRANSPORT === "http" && !env.MCP_HTTP_AUTH_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["MCP_HTTP_AUTH_TOKEN"],
        message: "MCP_HTTP_AUTH_TOKEN (>= 16 chars) is required when MCP_TRANSPORT=http",
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
