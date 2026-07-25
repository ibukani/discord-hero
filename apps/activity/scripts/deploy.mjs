import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readWranglerConfig } from "../../../scripts/deployment/config.mjs";

const allowedEnvironments = new Set(["staging", "production"]);
const environment = process.argv[2];

if (environment === undefined || !allowedEnvironments.has(environment)) {
  throw new Error("Deployment environment must be staging or production");
}

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const configPath = resolve(repositoryRoot, "apps/activity/wrangler.jsonc");
const config = await readWranglerConfig(configPath);
const discordClientId =
  process.env.VITE_DISCORD_CLIENT_ID ?? config.env?.[environment]?.vars?.DISCORD_CLIENT_ID ?? "";
const workerHost =
  process.env.VITE_WORKER_HOST ?? `${config.env?.[environment]?.name}.ibuebi777.workers.dev`;

run("node", ["../../scripts/deployment/preflight.mjs", environment], process.env);
run("node", ["../../scripts/assets/prepare.mjs", "--mode", environment], process.env);
run("npm", ["exec", "--", "vite", "build"], {
  ...process.env,
  CLOUDFLARE_ENV: environment,
  VITE_PLATFORM_MODE: "discord",
  VITE_DISCORD_CLIENT_ID: discordClientId,
  VITE_WORKER_HOST: workerHost,
});
run("npm", ["exec", "--", "wrangler", "deploy"], {
  ...process.env,
  VITE_DISCORD_CLIENT_ID: discordClientId,
  VITE_WORKER_HOST: workerHost,
});

function run(command, argumentsList, environmentVariables) {
  const result = spawnSync(command, argumentsList, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: environmentVariables,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
