import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { baseReference, collectChangedFiles } from "./git-changes.mjs";
import { isRecord, pathExists, readJson, repositoryRoot } from "./lib.mjs";

const argumentsList = process.argv.slice(2);
const baseRef = baseReference(argumentsList);
const candidates = [];
const taskPathPattern = /^\.ai\/tasks\/[a-z0-9][a-z0-9._-]{2,63}\.json$/u;

for (const file of collectChangedFiles({ baseRef })) {
  if (!file.startsWith(".ai/tasks/")) {
    continue;
  }
  if (!taskPathPattern.test(file)) {
    throw new Error(`Changed AI task contract has an invalid path: ${file}`);
  }
  const absolutePath = join(repositoryRoot, file);
  if (!(await pathExists(absolutePath))) {
    throw new Error(`AI task contracts may not be deleted in a change: ${file}`);
  }
  const task = await readJson(absolutePath);
  const expectedId = file.slice(".ai/tasks/".length, -".json".length);
  if (!isRecord(task) || task.id !== expectedId) {
    throw new Error(`${file} must contain an id matching its filename`);
  }
  candidates.push(file);
}

if (candidates.length > 1) {
  throw new Error(`Change range contains multiple AI task contracts: ${candidates.join(", ")}`);
}

const selected = candidates[0] ?? "";
const outputIndex = argumentsList.indexOf("--github-output");
if (outputIndex >= 0) {
  const outputPath = argumentsList[outputIndex + 1];
  if (outputPath === undefined || outputPath.startsWith("--")) {
    throw new Error("--github-output requires a file path");
  }
  await appendFile(outputPath, `file=${selected}\n`);
}

console.log(selected);
