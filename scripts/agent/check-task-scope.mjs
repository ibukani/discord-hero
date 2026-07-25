import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { isRecord, readJson, relativeToRoot, repositoryRoot } from "./lib.mjs";

const configuredPath = process.env.AGENT_TASK_FILE?.trim() || undefined;
const argumentPath = process.argv.find(
  (argument) => !argument.startsWith("-") && argument.endsWith(".json"),
);
const selectedPath = argumentPath ?? configuredPath;

if (selectedPath === undefined) {
  console.log("Task scope check skipped because AGENT_TASK_FILE is not set.");
  process.exit(0);
}

const taskPath = resolve(repositoryRoot, selectedPath);
const task = await readJson(taskPath);
if (!isRecord(task) || !Array.isArray(task.allowedPaths) || !Array.isArray(task.forbiddenPaths)) {
  throw new Error(`Task contract has no valid scope: ${relativeToRoot(taskPath)}`);
}

const allowedPatterns = task.allowedPaths.filter((value) => typeof value === "string");
const forbiddenPatterns = task.forbiddenPaths.filter((value) => typeof value === "string");
const changedFiles = readChangedFiles();
const violations = [];

for (const file of changedFiles) {
  const allowed = allowedPatterns.some((pattern) => globMatches(pattern, file));
  const forbidden = forbiddenPatterns.some((pattern) => globMatches(pattern, file));
  if (!allowed) {
    violations.push(`${file}: outside allowedPaths`);
  }
  if (forbidden) {
    violations.push(`${file}: matches forbiddenPaths`);
  }
}

if (violations.length > 0) {
  console.error(`Task scope violations for ${relativeToRoot(taskPath)}:\n`);
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Task scope valid for ${changedFiles.length} changed files.`);
}

function readChangedFiles() {
  const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    console.warn("Git status is unavailable; no changed files were checked.");
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.includes(" -> ") ? (line.split(" -> ").at(-1) ?? line) : line))
    .map((line) => line.replaceAll("\\", "/"))
    .sort((left, right) => left.localeCompare(right));
}

function globMatches(pattern, value) {
  const expression = globToRegExp(pattern.replaceAll("\\", "/"));
  return expression.test(value);
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];
    if (character === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (character === "*") {
      source += "[^/]*";
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(character ?? "");
  }
  return new RegExp(`${source}$`, "u");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
