import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

beforeAll(async () => {
  const migrations = ((env as unknown as Record<string, unknown>)["TEST_MIGRATIONS"] ?? []) as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
});
