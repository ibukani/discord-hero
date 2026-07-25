import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function readJson(path) {
  const source = await readFile(path, "utf8");
  return JSON.parse(source);
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function collectFiles(directory, options = {}) {
  const extensions = new Set(options.extensions ?? []);
  const ignored = new Set(
    options.ignoredDirectories ?? ["node_modules", "dist", "coverage", ".wrangler", ".git"],
  );
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignored.has(entry.name)) {
      continue;
    }
    const child = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(child, options)));
      continue;
    }
    if (extensions.size === 0 || extensions.has(extname(entry.name))) {
      files.push(child);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function relativeToRoot(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNodeError(value) {
  return value instanceof Error && "code" in value;
}
