import { spawnSync } from "node:child_process";
import { readJson, repositoryRoot } from "./agent/lib.mjs";

const manifest = await readJson(new URL("../package.json", import.meta.url));
const expectedNpmVersion =
  typeof manifest.packageManager === "string" && manifest.packageManager.startsWith("npm@")
    ? manifest.packageManager.slice("npm@".length)
    : null;

if (expectedNpmVersion === null) {
  throw new Error("package.json must pin packageManager to an npm version");
}

const actualNpmVersion = runNpm(["--version"]).stdout.trim();
if (actualNpmVersion !== expectedNpmVersion) {
  throw new Error(`Expected npm ${expectedNpmVersion}, received npm ${actualNpmVersion}`);
}

runNpm(["ls", "--all"]);

const audit = runNpm(["audit", "--audit-level=high", "--json"], [0]);
const auditReport = parseJson(audit.stdout, "npm audit");
const vulnerabilityCounts = auditReport?.metadata?.vulnerabilities;
const high = numericProperty(vulnerabilityCounts, "high");
const critical = numericProperty(vulnerabilityCounts, "critical");
if (high > 0 || critical > 0) {
  throw new Error(`Dependency audit found ${high} high and ${critical} critical vulnerabilities`);
}

const installScripts = runNpm(["install-scripts", "ls", "--json"]);
const installScriptReport = parseJson(installScripts.stdout, "npm install-scripts ls");
const pendingScripts = collectPendingInstallScripts(installScriptReport);
if (pendingScripts.length > 0) {
  throw new Error(`Unreviewed dependency install scripts: ${pendingScripts.join(", ")}`);
}

console.log(
  `Dependency policy valid with npm ${actualNpmVersion}; dependency tree, audit, and install-script approvals passed.`,
);

function runNpm(argumentsList, allowedStatuses = [0]) {
  const result = spawnSync("npm", argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!allowedStatuses.includes(result.status ?? -1)) {
    const output = [result.stdout ?? "", result.stderr ?? ""]
      .filter((part) => part.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `npm ${argumentsList.join(" ")} failed${output.length === 0 ? "" : `:\n${output}`}`,
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} did not return JSON`, { cause: error });
  }
}

function numericProperty(value, property) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("npm audit returned malformed vulnerability metadata");
  }
  const candidate = value[property];
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0) {
    throw new Error(`npm audit returned an invalid ${property} count`);
  }
  return candidate;
}

function collectPendingInstallScripts(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectPendingInstallScripts);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const pending = value.change === "pending" && typeof value.key === "string" ? [value.key] : [];
  return [
    ...pending,
    ...Object.values(value).flatMap((candidate) => collectPendingInstallScripts(candidate)),
  ];
}
