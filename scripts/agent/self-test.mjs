import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./lib.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "discord-hero-agent-harness-"));
const copyRoot = join(temporaryRoot, "repository");

try {
  await cp(repositoryRoot, copyRoot, {
    recursive: true,
    filter: shouldInclude,
  });

  expectStatus(runNode("scripts/agent/check-architecture.mjs"), 0, "baseline architecture");
  expectStatus(runNode("scripts/assets/validate.mjs"), 0, "baseline asset registry");
  await withRestoredFile("packages/game-core/src/random.ts", async (path) => {
    await appendFile(path, "\nMath.random();\n");
    expectFailure(runNode("scripts/agent/check-architecture.mjs"), "forbidden random access");
  });

  expectStatus(runNode("scripts/agent/generate-repo-map.mjs", ["--check"]), 0, "baseline map");
  await withRestoredFile("packages/content/package.json", async (path) => {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.version = "9.9.9";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    expectFailure(runNode("scripts/agent/generate-repo-map.mjs", ["--check"]), "stale map");
  });

  expectStatus(runNode("scripts/agent/create-task.mjs", ["self-test-task"]), 0, "task creation");
  expectStatus(
    runNode("scripts/agent/validate-task.mjs", [".ai/tasks/self-test-task.json"]),
    0,
    "created task contract",
  );
  expectFailure(
    runNode("scripts/agent/create-task.mjs", ["self-test-task"]),
    "task overwrite protection",
  );

  await writeFile(
    join(copyRoot, ".ai/tasks/invalid.json"),
    JSON.stringify({ schemaVersion: 1, id: "invalid" }, null, 2),
  );
  expectFailure(runNode("scripts/agent/validate-task.mjs", ["--all"]), "invalid task contract");
  await rm(join(copyRoot, ".ai/tasks/invalid.json"));

  initializeGitRepository();
  const privateAsset =
    ".local/assets/packs/tiny-rpg-soldier-orc/2.0/Characters(100x100 split)/Soldier/Soldier/Soldier_Idle.png";
  const forceAdd = spawnSync("git", ["add", "-f", privateAsset], {
    cwd: copyRoot,
    encoding: "utf8",
  });
  expectStatus(forceAdd, 0, "private asset force-add setup");
  expectFailure(runNode("scripts/assets/validate.mjs"), "tracked private asset policy");
  const resetPrivate = spawnSync("git", ["reset", "--quiet", "HEAD", "--", privateAsset], {
    cwd: copyRoot,
    encoding: "utf8",
  });
  expectStatus(resetPrivate, 0, "private asset reset");
  await appendFile(join(copyRoot, "docs/AI_CODING_HARNESS.md"), "\nAllowed scope self-test.\n");
  expectStatus(
    runNode("scripts/agent/check-task-scope.mjs", [".ai/task.template.json"]),
    0,
    "allowed task scope",
  );
  await appendFile(
    join(copyRoot, ".github/workflows/deploy-production.yml"),
    "\n# Forbidden scope self-test\n",
  );
  expectFailure(
    runNode("scripts/agent/check-task-scope.mjs", [".ai/task.template.json"]),
    "forbidden task scope",
  );

  console.log("AI harness self-test passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function runNode(script, argumentsList = []) {
  return spawnSync(process.execPath, [script, ...argumentsList], {
    cwd: copyRoot,
    encoding: "utf8",
    env: { ...process.env, AGENT_TASK_FILE: "" },
    maxBuffer: 20 * 1024 * 1024,
  });
}

function expectStatus(result, expectedStatus, label) {
  if (result.status !== expectedStatus) {
    throw new Error(
      `${label} returned ${String(result.status)} instead of ${expectedStatus}:\n${combinedOutput(result)}`,
    );
  }
}

function expectFailure(result, label) {
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed`);
  }
}

function combinedOutput(result) {
  const parts = [result.stdout ?? "", result.stderr ?? ""];
  if (result.error instanceof Error) {
    parts.push(`${result.error.name}: ${result.error.message}`);
  }
  if (result.signal !== null) {
    parts.push(`signal: ${result.signal}`);
  }
  return parts
    .filter((part) => part.length > 0)
    .join("\n")
    .trim();
}

async function withRestoredFile(relativePath, callback) {
  const path = join(copyRoot, relativePath);
  const original = await readFile(path, "utf8");
  try {
    await callback(path);
  } finally {
    await writeFile(path, original);
  }
}

function initializeGitRepository() {
  for (const [command, argumentsList] of [
    ["git", ["init", "--quiet"]],
    ["git", ["config", "user.email", "harness@example.invalid"]],
    ["git", ["config", "user.name", "Harness Self Test"]],
    ["git", ["add", "."]],
    ["git", ["commit", "--quiet", "-m", "baseline"]],
  ]) {
    const result = spawnSync(command, argumentsList, {
      cwd: copyRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`Failed to initialize test repository:\n${combinedOutput(result)}`);
    }
  }
}

function shouldInclude(source) {
  const normalized = source.replaceAll("\\", "/");
  return !["/node_modules", "/dist", "/.wrangler", "/coverage", "/.artifacts", "/.git"].some(
    (segment) => normalized.endsWith(segment) || normalized.includes(`${segment}/`),
  );
}
