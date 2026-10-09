import { pino, type DestinationStream, type Logger } from "pino";

/**
 * Structured logger. Always writes to stderr: with the stdio transport,
 * stdout is reserved for JSON-RPC frames and any stray write corrupts the
 * protocol stream.
 */
export function createLogger(level = "info", destination: DestinationStream = pino.destination(2)): Logger {
  return pino(
    {
      name: "mcp-practice-management",
      level,
      base: { service: "mcp-practice-management-server" },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          "args.email",
          "args.phone",
          "*.clientSecret",
          "*.client_secret",
          "*.accessToken",
          "*.access_token",
          "*.authorization",
          "*.Authorization",
        ],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
}

export type { Logger };
