import { readFile, readdir } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { collectFiles, isRecord, readJson, relativeToRoot, repositoryRoot } from "./lib.mjs";

const rulesPath = join(repositoryRoot, ".ai/architecture-rules.json");
const rules = await readJson(rulesPath);
if (!isRecord(rules) || !isRecord(rules.packages) || typeof rules.workspacePrefix !== "string") {
  throw new Error("Invalid .ai/architecture-rules.json");
}

const workspaces = await loadWorkspaces();
const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const violations = [];
const actualEdges = new Map(workspaces.map((workspace) => [workspace.name, new Set()]));

for (const workspace of workspaces) {
  const packageRule = rules.packages[workspace.name];
  if (!isRecord(packageRule)) {
    violations.push(`${workspace.path}: missing architecture rule for ${workspace.name}`);
    continue;
  }

  const files = await collectFiles(workspace.absolutePath, { extensions: [".ts", ".tsx"] });
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const filePath = relativeToRoot(file);
    const isTestFile = /(?:^|\/)test(?:\/|$)|\.(?:test|spec)\.[cm]?tsx?$/u.test(filePath);

    for (const patternRule of asRecordArray(packageRule.forbiddenSourcePatterns)) {
      if (typeof patternRule.label !== "string" || typeof patternRule.pattern !== "string") {
        violations.push(`${workspace.path}: malformed forbiddenSourcePatterns entry`);
        continue;
      }
      const pattern = new RegExp(patternRule.pattern, "u");
      if (pattern.test(source)) {
        violations.push(`${filePath}: forbidden ${patternRule.label}`);
      }
    }

    for (const specifier of extractModuleSpecifiers(source)) {
      if (specifier.startsWith(rules.workspacePrefix)) {
        const importedPackage = workspacePackageName(specifier);
        if (!workspaceByName.has(importedPackage)) {
          violations.push(`${filePath}: unknown workspace import ${specifier}`);
          continue;
        }
        actualEdges.get(workspace.name)?.add(importedPackage);
        const allowed = stringSet(packageRule.allowedWorkspaceDependencies);
        const testOnly = stringSet(packageRule.testOnlyWorkspaceDependencies);
        if (!allowed.has(importedPackage) && !(isTestFile && testOnly.has(importedPackage))) {
          violations.push(
            `${filePath}: ${workspace.name} may not import ${importedPackage}${isTestFile ? " in tests" : ""}`,
          );
        }
        if (!declaresDependency(workspace.manifest, importedPackage, isTestFile)) {
          violations.push(
            `${filePath}: ${importedPackage} is not declared in ${workspace.path}/package.json`,
          );
        }
      }

      for (const forbiddenImport of stringSet(packageRule.forbiddenImports)) {
        if (specifier === forbiddenImport || specifier.startsWith(`${forbiddenImport}/`)) {
          violations.push(`${filePath}: forbidden import ${specifier}`);
        }
      }

      checkActivityBoundary(file, filePath, specifier, violations);
    }
  }
}

for (const cycle of findCycles(actualEdges)) {
  violations.push(`workspace dependency cycle: ${cycle.join(" -> ")}`);
}

if (violations.length > 0) {
  console.error("Architecture boundary violations found:\n");
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture boundaries valid across ${workspaces.length} workspaces.`);
}

async function loadWorkspaces() {
  const roots = ["apps", "packages"];
  const result = [];
  for (const rootName of roots) {
    const rootPath = join(repositoryRoot, rootName);
    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const absolutePath = join(rootPath, entry.name);
      const manifest = await readJson(join(absolutePath, "package.json"));
      if (!isRecord(manifest) || typeof manifest.name !== "string") {
        throw new Error(`Invalid package manifest: ${relative(repositoryRoot, absolutePath)}`);
      }
      result.push({
        name: manifest.name,
        path: `${rootName}/${entry.name}`,
        absolutePath,
        manifest,
      });
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function extractModuleSpecifiers(source) {
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  const values = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        values.add(specifier);
      }
    }
  }
  return values;
}

function workspacePackageName(specifier) {
  const parts = specifier.split("/");
  return parts.slice(0, 2).join("/");
}

function stringSet(value) {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((item) => typeof item === "string"));
}

function asRecordArray(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function declaresDependency(manifest, packageName, isTestFile) {
  const runtimeSections = [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  if (runtimeSections.some((section) => isRecord(section) && packageName in section)) {
    return true;
  }
  return (
    isTestFile && isRecord(manifest.devDependencies) && packageName in manifest.devDependencies
  );
}

function checkActivityBoundary(file, filePath, specifier, output) {
  const normalizedFile = normalize(file);
  const clientRoot = normalize(join(repositoryRoot, "apps/activity/src/client"));
  const workerRoot = normalize(join(repositoryRoot, "apps/activity/src/worker"));
  if (!specifier.startsWith(".")) {
    if (
      normalizedFile.startsWith(workerRoot) &&
      ["react", "react-dom", "pixi.js", "@discord/embedded-app-sdk"].some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      )
    ) {
      output.push(`${filePath}: worker code may not import browser framework ${specifier}`);
    }
    return;
  }

  const resolved = normalize(resolve(dirname(file), specifier));
  if (normalizedFile.startsWith(clientRoot) && resolved.startsWith(workerRoot)) {
    output.push(`${filePath}: client code may not import worker code`);
  }
  if (normalizedFile.startsWith(workerRoot) && resolved.startsWith(clientRoot)) {
    output.push(`${filePath}: worker code may not import client code`);
  }
}

function findCycles(edges) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(node, path) {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      cycles.push([...path.slice(start), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    for (const dependency of edges.get(node) ?? []) {
      visit(dependency, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of edges.keys()) {
    visit(node, []);
  }
  return uniqueCycles(cycles);
}

function uniqueCycles(cycles) {
  const seen = new Set();
  const result = [];
  for (const cycle of cycles) {
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
    const key = rotations.map((rotation) => rotation.join("|")).sort()[0];
    if (key !== undefined && !seen.has(key)) {
      seen.add(key);
      result.push(cycle);
    }
  }
  return result;
}
