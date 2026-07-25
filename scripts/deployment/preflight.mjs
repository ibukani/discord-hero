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
const hasAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim().length > 0;
const hasApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim().length > 0;
const missingCredentials = [];
if (!hasApiToken && !hasAccount) {
  const isOauthLoggedIn =
    spawnSync("npx", ["wrangler", "whoami"], {
      shell: process.platform === "win32",
      encoding: "utf8",
    }).status === 0;
  if (!isOauthLoggedIn) {
    missingCredentials.push("CLOUDFLARE_API_TOKEN or wrangler login is required for deployment");
  }
}
const config = await readWranglerConfig(configPath);
const violations = [
  ...missingCredentials.map((name) => `${name} is required for deployment`),
  ...validateDeploymentConfig(
    config,
    environment,
    process.env.VITE_DISCORD_CLIENT_ID ?? config.env?.[environment]?.vars?.DISCORD_CLIENT_ID ?? "",
  ),
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
    const stdout = (result.stdout ?? "").trim();
    const jsonIndex = stdout.indexOf("[");
    const jsonString = jsonIndex >= 0 ? stdout.slice(jsonIndex) : stdout;
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error("Wrangler secret list returned invalid JSON", { cause: error });
  }
}
