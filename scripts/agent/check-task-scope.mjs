import { resolve } from "node:path";
import { baseReference, collectChangedFiles } from "./git-changes.mjs";
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
const baseRef = baseReference();
const changedFiles = collectChangedFiles({ baseRef });
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
  const source = baseRef === null ? "working tree" : `${baseRef}...HEAD and working tree`;
  console.log(`Task scope valid for ${changedFiles.length} changed files from ${source}.`);
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
