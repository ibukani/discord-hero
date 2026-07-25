import { spawnSync } from "node:child_process";

const allowedEnvironments = new Set(["staging", "production"]);
const environment = process.argv[2];

if (environment === undefined || !allowedEnvironments.has(environment)) {
  throw new Error("Deployment environment must be staging or production");
}

run("node", ["../../scripts/deployment/preflight.mjs", environment], process.env);
run("node", ["../../scripts/assets/prepare.mjs", "--mode", environment], process.env);
run("npm", ["exec", "--", "vite", "build"], {
  ...process.env,
  CLOUDFLARE_ENV: environment,
  VITE_PLATFORM_MODE: "discord",
});
run("npm", ["exec", "--", "wrangler", "deploy"], process.env);

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
