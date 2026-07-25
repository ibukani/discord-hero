import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isRecord, readJson, repositoryRoot } from "./lib.mjs";

const metadata = await readJson(join(repositoryRoot, ".ai/repository-metadata.json"));
if (!isRecord(metadata) || !Array.isArray(metadata.packages)) {
  throw new Error("Invalid repository metadata");
}

const changedFiles = gitChangedFiles();
const matchedPackages = metadata.packages
  .filter(isRecord)
  .filter((entry) => {
    const path = typeof entry.path === "string" ? entry.path : "";
    return changedFiles.some((file) => file === path || file.startsWith(`${path}/`));
  })
  .map((entry) => ({
    name: entry.name,
    path: entry.path,
    responsibility: entry.responsibility,
  }));

const taskPath = selectedTaskFile();
const report = {
  generatedAt: new Date().toISOString(),
  taskFile: taskPath,
  changedFiles,
  affectedPackages: matchedPackages,
  recommendedFirstReads: ["AGENTS.md", ".ai/REPOSITORY_MAP.md", taskPath],
};

const outputDirectory = join(repositoryRoot, ".artifacts/agent");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "inspection.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Task: ${taskPath}`);
console.log(`Changed files: ${changedFiles.length}`);
if (matchedPackages.length > 0) {
  console.log(`Affected packages: ${matchedPackages.map((entry) => entry.name).join(", ")}`);
} else {
  console.log("Affected packages: none detected from git diff");
}
console.log("Inspection report: .artifacts/agent/inspection.json");

function selectedTaskFile() {
  const argument = process.argv
    .slice(2)
    .find((value) => !value.startsWith("-") && value.endsWith(".json"));
  if (argument !== undefined) {
    return argument;
  }
  const configured = process.env.AGENT_TASK_FILE?.trim();
  return configured === undefined || configured.length === 0
    ? ".ai/task.template.json"
    : configured;
}

function gitChangedFiles() {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
}
