import { z } from "zod";

const AppEnvironmentSchema = z.enum(["local", "staging", "production"]);
const RuntimeVariablesSchema = z
  .object({
    APP_ENV: AppEnvironmentSchema,
    ALLOW_LOCAL_AUTH: z.enum(["false", "true"]),
    DISCORD_CLIENT_ID: z.string().min(1).max(64),
    DISCORD_CLIENT_SECRET: z.string().min(1).max(4_096),
    SESSION_SIGNING_SECRET: z.string().min(32).max(4_096),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV !== "local" && value.ALLOW_LOCAL_AUTH !== "false") {
      context.addIssue({
        code: "custom",
        path: ["ALLOW_LOCAL_AUTH"],
        message: "Local authentication must be disabled outside local mode",
      });
    }
    if (value.APP_ENV !== "local" && !/^\d{17,20}$/u.test(value.DISCORD_CLIENT_ID)) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_CLIENT_ID"],
        message: "A deployed Discord client ID must be a Discord snowflake",
      });
    }
  });

export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;
export type RuntimeVariables = z.infer<typeof RuntimeVariablesSchema>;
export type RuntimeEnv = Cloudflare.Env & RuntimeVariables;

export function parseRuntimeVariables(value: unknown): RuntimeVariables {
  const parsed = RuntimeVariablesSchema.safeParse(value);
  if (!parsed.success) {
    throw new RuntimeEnvironmentError();
  }
  return parsed.data;
}

export function assertRuntimeEnv(env: Cloudflare.Env): asserts env is RuntimeEnv {
  parseRuntimeVariables(env);
}

export class RuntimeEnvironmentError extends Error {
  public constructor() {
    super("invalid_runtime_environment");
    this.name = "RuntimeEnvironmentError";
  }
}
