import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isRecord, readJson, relativeToRoot, repositoryRoot } from "./lib.mjs";

const argumentPath = process.argv.find(
  (argument) => !argument.startsWith("-") && argument.endsWith(".json"),
);
const configuredPath = process.env.AGENT_TASK_FILE?.trim() || undefined;
const taskPaths = process.argv.includes("--all")
  ? await allTaskPaths()
  : [resolve(repositoryRoot, argumentPath ?? configuredPath ?? ".ai/task.template.json")];
let invalidCount = 0;

for (const taskPath of taskPaths) {
  const task = await readJson(taskPath);
  const violations = validateTask(task);
  if (violations.length > 0) {
    invalidCount += 1;
    console.error(`Invalid AI task contract ${relativeToRoot(taskPath)}:\n`);
    console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  } else {
    console.log(`AI task contract valid: ${relativeToRoot(taskPath)}`);
  }
}

if (invalidCount > 0) {
  process.exitCode = 1;
}

async function allTaskPaths() {
  const paths = [resolve(repositoryRoot, ".ai/task.template.json")];
  const taskDirectory = resolve(repositoryRoot, ".ai/tasks");
  const entries = await readdir(taskDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      paths.push(join(taskDirectory, entry.name));
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

function validateTask(value) {
  if (!isRecord(value)) {
    return ["root must be an object"];
  }
  const output = [];
  const allowedKeys = new Set([
    "$schema",
    "schemaVersion",
    "id",
    "title",
    "objective",
    "risk",
    "constraints",
    "acceptanceCriteria",
    "requiredChecks",
    "allowedPaths",
    "forbiddenPaths",
    "notes",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      output.push(`unsupported property: ${key}`);
    }
  }

  if (value.schemaVersion !== 1) {
    output.push("schemaVersion must equal 1");
  }
  validateString(value.id, "id", output, 3, 64, /^[a-z0-9][a-z0-9._-]+$/u);
  validateString(value.title, "title", output, 3, 120);
  validateString(value.objective, "objective", output, 10, 1000);
  if (!new Set(["low", "medium", "high"]).has(value.risk)) {
    output.push("risk must be low, medium, or high");
  }
  validateStringArray(value.constraints, "constraints", output, true);
  validateStringArray(value.requiredChecks, "requiredChecks", output, true);
  validateRequiredChecks(value.requiredChecks, output);
  validateStringArray(value.allowedPaths, "allowedPaths", output, true);
  validateStringArray(value.forbiddenPaths, "forbiddenPaths", output, false);

  if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length === 0) {
    output.push("acceptanceCriteria must be a non-empty array");
  } else {
    const ids = new Set();
    value.acceptanceCriteria.forEach((criterion, index) => {
      if (!isRecord(criterion)) {
        output.push(`acceptanceCriteria[${index}] must be an object`);
        return;
      }
      const keys = Object.keys(criterion);
      if (keys.some((key) => !new Set(["id", "description", "verification"]).has(key))) {
        output.push(`acceptanceCriteria[${index}] contains unsupported properties`);
      }
      validateString(
        criterion.id,
        `acceptanceCriteria[${index}].id`,
        output,
        4,
        16,
        /^AC-[0-9]+$/u,
      );
      validateString(
        criterion.description,
        `acceptanceCriteria[${index}].description`,
        output,
        5,
        1000,
      );
      validateString(
        criterion.verification,
        `acceptanceCriteria[${index}].verification`,
        output,
        3,
        500,
      );
      if (typeof criterion.id === "string") {
        if (ids.has(criterion.id)) {
          output.push(`duplicate acceptance criterion id: ${criterion.id}`);
        }
        ids.add(criterion.id);
      }
    });
  }

  for (const field of ["allowedPaths", "forbiddenPaths"]) {
    const paths = value[field];
    if (Array.isArray(paths)) {
      paths.forEach((pathValue, index) => {
        if (typeof pathValue === "string" && pathValue.split(/[\\/]/u).includes("..")) {
          output.push(`${field}[${index}] may not traverse to a parent directory`);
        }
      });
    }
  }

  return output;
}

function validateString(value, label, output, minimum, maximum, pattern) {
  if (typeof value !== "string") {
    output.push(`${label} must be a string`);
    return;
  }
  if (value.length < minimum || value.length > maximum) {
    output.push(`${label} length must be between ${minimum} and ${maximum}`);
  }
  if (pattern !== undefined && !pattern.test(value)) {
    output.push(`${label} has an invalid format`);
  }
}

function validateStringArray(value, label, output, requireItems) {
  if (!Array.isArray(value) || (requireItems && value.length === 0)) {
    output.push(`${label} must be ${requireItems ? "a non-empty" : "an"} array`);
    return;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      output.push(`${label}[${index}] must be a non-empty string`);
      return;
    }
    if (seen.has(item)) {
      output.push(`${label} contains a duplicate value: ${item}`);
    }
    seen.add(item);
  });
}

function validateRequiredChecks(value, output) {
  if (!Array.isArray(value)) {
    return;
  }
  const allowed = new Set([
    "format",
    "lint",
    "typecheck",
    "test",
    "build",
    "agent-smoke",
    "db-migrate-local",
  ]);
  value.forEach((item, index) => {
    if (typeof item === "string" && !allowed.has(item)) {
      output.push(`requiredChecks[${index}] is not supported: ${item}`);
    }
  });
}
