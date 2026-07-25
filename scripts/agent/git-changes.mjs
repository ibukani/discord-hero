import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./lib.mjs";

export function baseReference(argumentsList = process.argv.slice(2)) {
  const optionIndex = argumentsList.indexOf("--base");
  if (optionIndex >= 0) {
    const value = argumentsList[optionIndex + 1]?.trim();
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new Error("--base requires a Git revision");
    }
    return value;
  }
  const configured = process.env.AGENT_BASE_REF?.trim();
  return configured === undefined || configured.length === 0 ? null : configured;
}

export function collectChangedFiles(options = {}) {
  const files = new Set();
  const baseRef = options.baseRef ?? null;

  if (baseRef !== null) {
    addNameStatus(
      files,
      runGit(["diff", "--name-status", "-z", "--find-renames", `${baseRef}...HEAD`]),
    );
  }
  addNameStatus(files, runGit(["diff", "--name-status", "-z", "--find-renames"]));
  addNameStatus(files, runGit(["diff", "--cached", "--name-status", "-z", "--find-renames"]));
  addPaths(files, runGit(["ls-files", "--others", "--exclude-standard", "-z"]));

  return [...files].sort((left, right) => left.localeCompare(right));
}

function runGit(argumentsList) {
  const result = spawnSync("git", argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    const diagnostic = [result.stdout ?? "", result.stderr ?? ""]
      .filter((part) => part.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `Git change discovery failed for git ${argumentsList.join(" ")}${diagnostic.length === 0 ? "" : `:\n${diagnostic}`}`,
    );
  }
  return result.stdout;
}

function addNameStatus(output, source) {
  const fields = nullSeparatedFields(source);
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    const firstPath = fields[index + 1];
    if (status === undefined || firstPath === undefined) {
      throw new Error("Git returned malformed --name-status output");
    }
    output.add(normalizePath(firstPath));
    index += 2;

    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = fields[index];
      if (secondPath === undefined) {
        throw new Error("Git returned a rename or copy without a destination");
      }
      output.add(normalizePath(secondPath));
      index += 1;
    }
  }
}

function addPaths(output, source) {
  for (const path of nullSeparatedFields(source)) {
    output.add(normalizePath(path));
  }
}

function nullSeparatedFields(source) {
  const fields = source.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  return fields;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}
