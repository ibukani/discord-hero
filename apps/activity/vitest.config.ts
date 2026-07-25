import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const TEST_SIGNING_SECRET = "test-signing-secret-with-at-least-32-characters";
const currentDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const readMigrations = readD1Migrations as unknown as (dir: string) => Promise<unknown>;
      const migrations = await readMigrations(join(currentDirectory, "../../migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            APP_ENV: "local",
            ALLOW_LOCAL_AUTH: "true",
            DISCORD_CLIENT_ID: "test-discord-client",
            DISCORD_CLIENT_SECRET: "test-discord-secret",
            SESSION_SIGNING_SECRET: TEST_SIGNING_SECRET,
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
