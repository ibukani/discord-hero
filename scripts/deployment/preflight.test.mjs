import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateDeploymentConfig, validateRemoteSecrets } from "./config.mjs";

const DISCORD_CLIENT_ID = "123456789012345678";

describe("deployment preflight", () => {
  it("accepts an isolated, fully configured production environment", () => {
    assert.deepEqual(validateDeploymentConfig(validConfig(), "production", DISCORD_CLIENT_ID), []);
  });

  it("rejects placeholders before deployment", () => {
    const config = validConfig();
    config.env.production.vars.DISCORD_CLIENT_ID = "REPLACE_WITH_PRODUCTION_DISCORD_CLIENT_ID";
    config.env.production.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000";

    const violations = validateDeploymentConfig(config, "production", DISCORD_CLIENT_ID);
    assert.ok(violations.some((violation) => violation.includes("DISCORD_CLIENT_ID")));
    assert.ok(violations.some((violation) => violation.includes("database_id")));
  });

  it("rejects local authentication and mismatched client IDs in production", () => {
    const config = validConfig();
    config.env.production.vars.ALLOW_LOCAL_AUTH = "true";

    const violations = validateDeploymentConfig(config, "production", "987654321098765432");
    assert.ok(violations.some((violation) => violation.includes("ALLOW_LOCAL_AUTH")));
    assert.ok(violations.some((violation) => violation.includes("must match")));
  });

  it("requires secret declarations and environment-specific resources", () => {
    const config = validConfig();
    config.env.production.secrets.required = ["SESSION_SIGNING_SECRET"];
    config.env.production.queues.producers[0].queue = "discord-hero-results-staging";
    config.env.production.ratelimits = [];

    const violations = validateDeploymentConfig(config, "production", DISCORD_CLIENT_ID);
    assert.ok(violations.some((violation) => violation.includes("DISCORD_CLIENT_SECRET")));
    assert.ok(violations.some((violation) => violation.includes("MATCH_RESULTS_QUEUE")));
    assert.ok(violations.some((violation) => violation.includes("AUTH_RATE_LIMITER")));
  });

  it("requires both secrets to exist on the remote Worker", () => {
    assert.deepEqual(
      validateRemoteSecrets([
        { name: "DISCORD_CLIENT_SECRET", type: "secret_text" },
        { name: "SESSION_SIGNING_SECRET", type: "secret_text" },
      ]),
      [],
    );
    assert.deepEqual(validateRemoteSecrets([{ name: "SESSION_SIGNING_SECRET" }]), [
      "Remote Worker secret is missing: DISCORD_CLIENT_SECRET",
    ]);
  });
});

function validConfig() {
  return {
    compatibility_flags: ["nodejs_compat"],
    observability: {
      enabled: true,
      traces: { enabled: true },
    },
    exports: {
      GameRoom: { type: "durable-object", storage: "sqlite" },
    },
    env: {
      production: {
        name: "discord-hero-production",
        secrets: {
          required: ["DISCORD_CLIENT_SECRET", "SESSION_SIGNING_SECRET"],
        },
        vars: {
          APP_ENV: "production",
          ALLOW_LOCAL_AUTH: "false",
          DISCORD_CLIENT_ID,
        },
        durable_objects: {
          bindings: [{ name: "GAME_ROOMS", class_name: "GameRoom" }],
        },
        d1_databases: [
          {
            binding: "DB",
            database_name: "discord-hero-production",
            database_id: "123e4567-e89b-42d3-a456-426614174000",
          },
        ],
        ratelimits: [
          {
            name: "AUTH_RATE_LIMITER",
            namespace_id: "10003",
            simple: { limit: 60, period: 60 },
          },
        ],
        queues: {
          producers: [
            {
              binding: "MATCH_RESULTS_QUEUE",
              queue: "discord-hero-results-production",
            },
          ],
          consumers: [
            {
              queue: "discord-hero-results-production",
              dead_letter_queue: "discord-hero-results-production-dlq",
            },
          ],
        },
      },
    },
  };
}
