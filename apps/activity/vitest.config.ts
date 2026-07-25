import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const TEST_SIGNING_SECRET = "test-signing-secret-with-at-least-32-characters";
const TEST_DISCORD_CLIENT_SECRET = "test-discord-secret";
const currentDirectory = dirname(fileURLToPath(import.meta.url));

setDefaultEnvironmentVariable("DISCORD_CLIENT_SECRET", TEST_DISCORD_CLIENT_SECRET);
setDefaultEnvironmentVariable("SESSION_SIGNING_SECRET", TEST_SIGNING_SECRET);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(join(currentDirectory, "../../migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            APP_ENV: "local",
            ALLOW_LOCAL_AUTH: "true",
            DISCORD_CLIENT_ID: "test-discord-client",
            DISCORD_CLIENT_SECRET: TEST_DISCORD_CLIENT_SECRET,
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
    testTimeout: 10_000,
  },
});

function setDefaultEnvironmentVariable(name: string, value: string): void {
  if (!Reflect.has(process.env, name)) {
    process.env[name] = value;
  }
}
