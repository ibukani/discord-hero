import { readFile, readdir } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
const checkedExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["node_modules", "dist", "coverage", ".wrangler"]);
const forbiddenPatterns = [
  { label: "explicit any type", pattern: /\bany\b/u },
  { label: "TypeScript suppression", pattern: /@ts-(?:ignore|nocheck)/u },
];

async function collectFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(childUrl)));
      continue;
    }

    if (entry.name.endsWith(".d.ts")) {
      continue;
    }

    if (checkedExtensions.has(extname(entry.name))) {
      files.push(childUrl);
    }
  }

  return files;
}

const violations = [];
for (const fileUrl of await collectFiles(root)) {
  const source = await readFile(fileUrl, "utf8");
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(line)) {
        const absolutePath = fileUrl.pathname;
        violations.push(
          `${relative(root.pathname, absolutePath)}:${index + 1}: ${forbidden.label}: ${line.trim()}`,
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Forbidden type-safety escapes found:\n");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("No explicit any types or TypeScript suppressions found.");
}
