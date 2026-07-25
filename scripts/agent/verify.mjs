import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isRecord, pathExists, readJson, repositoryRoot } from "./lib.mjs";

const staticOnly = process.argv.includes("--static-only");
const nodeModulesPresent = await pathExists(join(repositoryRoot, "node_modules"));
const taskFile = selectedTaskFile();
const taskArgument = taskFile === null ? [] : [taskFile];
const task = await readTaskForReport(taskFile);
const requiredChecks = taskRequiredChecks(task);
const acceptanceCriteria = taskAcceptanceCriteria(task);
const checks = [
  command("type-safety escapes", "node", ["scripts/check-no-any.mjs"]),
  command("architecture boundaries", "node", ["scripts/agent/check-architecture.mjs"]),
  command("task contract", "node", ["scripts/agent/validate-task.mjs", ...taskArgument]),
  command("task scope", "node", ["scripts/agent/check-task-scope.mjs", ...taskArgument]),
  command("repository map", "node", ["scripts/agent/generate-repo-map.mjs", "--check"]),
  command("asset registry", "node", ["scripts/assets/validate.mjs"]),
  command("harness self-test", "node", ["scripts/agent/self-test.mjs"]),
];

if (!staticOnly) {
  if (!nodeModulesPresent) {
    checks.push({
      name: "dependency-backed verification",
      status: "failed",
      durationMs: 0,
      command: "npm install then npm run agent:verify",
      output:
        "node_modules is missing; full type, lint, test, and build verification was not executed.",
    });
  } else {
    checks.push(command("format", npmCommand(), ["run", "format:check"]));
    checks.push(command("lint", npmCommand(), ["run", "lint"]));
    checks.push(command("typecheck", npmCommand(), ["run", "typecheck"]));
    checks.push(command("tests", npmCommand(), ["run", "test"]));
    checks.push(command("build", npmCommand(), ["run", "build"]));
    if (requiredChecks.has("agent-smoke")) {
      checks.push(command("focused agent smoke", npmCommand(), ["run", "agent:smoke"]));
    }
    if (requiredChecks.has("db-migrate-local")) {
      checks.push(command("local D1 migration", npmCommand(), ["run", "db:migrate:local"]));
    }
  }
}

const results = checks.map((check) => (typeof check.run === "function" ? check.run() : check));
const failed = results.filter((result) => result.status === "failed");
const report = {
  generatedAt: new Date().toISOString(),
  mode: staticOnly ? "static-only" : "full",
  taskFile,
  requiredChecks: [...requiredChecks],
  acceptanceCriteria,
  status: failed.length === 0 ? "passed" : "failed",
  checks: results.map((result) => ({
    name: result.name,
    status: result.status,
    durationMs: result.durationMs,
    command: result.command,
    output: result.output,
  })),
};

const outputDirectory = join(repositoryRoot, ".artifacts/agent");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(outputDirectory, "verification.md"), renderMarkdown(report));

for (const result of results) {
  console.log(`${statusSymbol(result.status)} ${result.name} (${result.durationMs}ms)`);
  if (result.status === "failed" && result.output.length > 0) {
    console.error(result.output);
  }
}
console.log(`Verification report: .artifacts/agent/verification.md`);
if (failed.length > 0) {
  process.exitCode = 1;
}

function selectedTaskFile() {
  const argument = process.argv
    .slice(2)
    .find((value) => !value.startsWith("-") && value.endsWith(".json"));
  if (argument !== undefined) {
    return argument;
  }
  const configured = process.env.AGENT_TASK_FILE?.trim();
  return configured === undefined || configured.length === 0 ? null : configured;
}

async function readTaskForReport(taskFile) {
  if (taskFile === null) {
    return null;
  }
  try {
    return await readJson(resolve(repositoryRoot, taskFile));
  } catch {
    return null;
  }
}

function taskRequiredChecks(task) {
  if (!isRecord(task) || !Array.isArray(task.requiredChecks)) {
    return new Set();
  }
  return new Set(task.requiredChecks.filter((value) => typeof value === "string"));
}

function taskAcceptanceCriteria(task) {
  if (!isRecord(task) || !Array.isArray(task.acceptanceCriteria)) {
    return [];
  }
  return task.acceptanceCriteria.filter(isRecord).map((criterion) => ({
    id: typeof criterion.id === "string" ? criterion.id : "invalid",
    description: typeof criterion.description === "string" ? criterion.description : "invalid",
    verification: typeof criterion.verification === "string" ? criterion.verification : "invalid",
  }));
}

function command(name, executable, argumentsList) {
  return {
    name,
    run() {
      const startedAt = performance.now();
      const result = spawnSync(executable, argumentsList, {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 20 * 1024 * 1024,
      });
      const outputParts = [result.stdout ?? "", result.stderr ?? ""];
      if (result.error instanceof Error) {
        outputParts.push(`${result.error.name}: ${result.error.message}`);
      }
      if (result.signal !== null) {
        outputParts.push(`signal: ${result.signal}`);
      }
      const output = outputParts
        .filter((part) => part.length > 0)
        .join("\n")
        .trim();
      return {
        name,
        status: result.status === 0 ? "passed" : "failed",
        durationMs: Math.round(performance.now() - startedAt),
        command: [executable, ...argumentsList].join(" "),
        output,
      };
    },
  };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function statusSymbol(status) {
  return status === "passed" ? "PASS" : "FAIL";
}

function renderMarkdown(report) {
  const lines = [
    "# AI verification report",
    "",
    `- Status: **${report.status}**`,
    `- Mode: \`${report.mode}\``,
    `- Generated: \`${report.generatedAt}\``,
    `- Task: ${report.taskFile === null ? "not specified" : `\`${report.taskFile}\``}`,
    "",
    "## Declared task requirements",
    "",
    `- Required checks: ${report.requiredChecks.length === 0 ? "none" : report.requiredChecks.map((value) => `\`${value}\``).join(", ")}`,
    "",
  ];
  if (report.acceptanceCriteria.length > 0) {
    lines.push("### Acceptance criteria", "");
    for (const criterion of report.acceptanceCriteria) {
      lines.push(`- **${criterion.id}** ${criterion.description}`);
      lines.push(`  - Verification: \`${criterion.verification}\``);
    }
    lines.push("");
  }
  lines.push("## Checks", "");
  for (const check of report.checks) {
    lines.push(`### ${statusSymbol(check.status)} — ${check.name}`);
    lines.push("");
    lines.push(`- Command: \`${check.command}\``);
    lines.push(`- Duration: ${check.durationMs}ms`);
    if (check.output.length > 0) {
      lines.push("", "```text", check.output, "```");
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
