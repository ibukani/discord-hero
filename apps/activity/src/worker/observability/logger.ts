import type { AppEnvironment } from "../env.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  readonly event: string;
  readonly requestId?: string;
  readonly roomIdHash?: string;
  readonly matchId?: string;
  readonly serverTick?: number;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface Logger {
  debug(context: LogContext): void;
  info(context: LogContext): void;
  warn(context: LogContext): void;
  error(context: LogContext): void;
}

export function createLogger(environment: AppEnvironment): Logger {
  function write(level: LogLevel, context: LogContext): void {
    const entry = {
      timestamp: new Date().toISOString(),
      environment,
      level,
      ...context,
    };
    const serialized = JSON.stringify(entry);
    switch (level) {
      case "debug":
      case "info":
        console.log(serialized);
        return;
      case "warn":
        console.warn(serialized);
        return;
      case "error":
        console.error(serialized);
        return;
    }
  }

  return {
    debug: (context) => {
      write("debug", context);
    },
    info: (context) => {
      write("info", context);
    },
    warn: (context) => {
      write("warn", context);
    },
    error: (context) => {
      write("error", context);
    },
  };
}

export function normalizeError(error: unknown): {
  readonly name: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError", message: "Unknown failure" };
}

export async function hashIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
