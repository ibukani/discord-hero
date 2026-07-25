import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readWranglerConfig, validateDeploymentConfig, validateRemoteSecrets } from "./config.mjs";

const environment = process.argv[2];
if (environment !== "staging" && environment !== "production") {
  throw new Error("Usage: npm run deploy:preflight -- <staging|production>");
}

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = resolve(repositoryRoot, "apps/activity/wrangler.jsonc");
const missingCredentials = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter(
  (name) => process.env[name]?.trim().length === 0 || process.env[name] === undefined,
);
const config = await readWranglerConfig(configPath);
const violations = [
  ...missingCredentials.map((name) => `${name} is required for deployment`),
  ...validateDeploymentConfig(config, environment, process.env.VITE_DISCORD_CLIENT_ID ?? ""),
];

if (violations.length === 0) {
  violations.push(...validateRemoteSecrets(listRemoteSecrets(environment, configPath)));
}

if (violations.length > 0) {
  console.error(`Deployment preflight failed for ${environment}:\n`);
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Deployment preflight passed for ${environment}.`);
}

function listRemoteSecrets(targetEnvironment, targetConfigPath) {
  const result = spawnSync(
    "npm",
    [
      "exec",
      "--",
      "wrangler",
      "secret",
      "list",
      "--env",
      targetEnvironment,
      "--format",
      "json",
      "--config",
      targetConfigPath,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: process.env,
      shell: process.platform === "win32",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Unable to list remote Worker secrets for ${targetEnvironment}`);
  }
  try {
    return JSON.parse(result.stdout ?? "");
  } catch (error) {
    throw new Error("Wrangler secret list returned invalid JSON", { cause: error });
  }
}
