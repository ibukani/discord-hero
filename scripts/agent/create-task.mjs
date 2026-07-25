import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson, repositoryRoot } from "./lib.mjs";

const taskId = process.argv[2];
if (taskId === undefined) {
  console.error("Usage: npm run agent:task -- <task-id>");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(taskId)) {
  console.error(
    "Task ID must contain 3-64 lowercase letters, numbers, dots, underscores, or hyphens.",
  );
  process.exit(1);
}

const template = await readJson(join(repositoryRoot, ".ai/task.template.json"));
const task = {
  ...template,
  $schema: "../task.schema.json",
  id: taskId,
  title: `${taskId} の変更内容を記述する`,
};
const taskDirectory = join(repositoryRoot, ".ai/tasks");
const taskPath = join(taskDirectory, `${taskId}.json`);
await mkdir(taskDirectory, { recursive: true });

try {
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, { flag: "wx" });
  console.log(`Created .ai/tasks/${taskId}.json`);
} catch (error) {
  if (isNodeError(error) && error.code === "EEXIST") {
    console.error(`Task already exists: .ai/tasks/${taskId}.json`);
    process.exit(1);
  }
  throw error;
}

function isNodeError(value) {
  return value instanceof Error && "code" in value;
}
