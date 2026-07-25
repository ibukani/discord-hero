import { describe, expect, it } from "vitest";
import { parseRuntimeVariables } from "../src/worker/env.js";

const validLocalEnvironment = {
  APP_ENV: "local",
  ALLOW_LOCAL_AUTH: "true",
  DISCORD_CLIENT_ID: "local-discord-client",
  DISCORD_CLIENT_SECRET: "local-discord-secret",
  SESSION_SIGNING_SECRET: "test-signing-secret-with-at-least-32-characters",
} as const;

describe("runtime environment validation", () => {
  it("accepts explicit local development settings", () => {
    expect(parseRuntimeVariables(validLocalEnvironment)).toEqual(validLocalEnvironment);
  });

  it("rejects local authentication outside local mode", () => {
    expect(() =>
      parseRuntimeVariables({
        ...validLocalEnvironment,
        APP_ENV: "production",
      }),
    ).toThrow("invalid_runtime_environment");
  });

  it("rejects deployment placeholders and missing secrets", () => {
    expect(() =>
      parseRuntimeVariables({
        ...validLocalEnvironment,
        APP_ENV: "staging",
        ALLOW_LOCAL_AUTH: "false",
        DISCORD_CLIENT_ID: "REPLACE_WITH_STAGING_DISCORD_CLIENT_ID",
        SESSION_SIGNING_SECRET: "short",
      }),
    ).toThrow("invalid_runtime_environment");
  });
});
