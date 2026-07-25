import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  displayPath,
  loadPackManifests,
  pathExists,
  readPngDimensions,
  repositoryRoot,
  resolveInside,
  sha256File,
  sourceRootFor,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const packs = await loadPackManifests();
const errors = [];
const warnings = [];
const assetIds = new Map();
const packIds = new Set();
for (const { manifestPath, manifest: pack } of packs) {
  if (packIds.has(pack.id)) {
    errors.push(`${displayPath(manifestPath)}: duplicate pack id ${pack.id}`);
  }
  packIds.add(pack.id);
  validatePolicy(pack, errors);
  const sourceRoot = sourceRootFor(pack);
  for (const file of pack.files) {
    const previous = assetIds.get(file.id);
    if (previous !== undefined) {
      errors.push(
        `${displayPath(manifestPath)}: duplicate asset id ${file.id}; already declared by ${previous}`,
      );
    }
    assetIds.set(file.id, pack.id);
    if (
      pack.delivery.kind === "external" &&
      file.externalUrl === null &&
      pack.source.kind === "external"
    ) {
      warnings.push(
        `${pack.id}/${file.id}: external assets should declare externalUrl when paths are not relative to baseUrl`,
      );
    }
    if (sourceRoot === null) {
      continue;
    }
    const sourcePath = resolveInside(sourceRoot, file.sourcePath, `${pack.id}.${file.id}`);
    if (!(await pathExists(sourcePath))) {
      const message = `${pack.id}/${file.id}: missing ${displayPath(sourcePath)}`;
      if (
        pack.required ||
        pack.source.kind === "repository" ||
        pack.source.kind === "git-lfs" ||
        pack.source.kind === "generated"
      ) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
      continue;
    }
    if (file.expected.sha256 !== null) {
      const actual = await sha256File(sourcePath);
      if (actual !== file.expected.sha256) {
        errors.push(`${pack.id}/${file.id}: checksum mismatch`);
      }
    }
    if (file.expected.image !== null) {
      const dimensions = await readPngDimensions(sourcePath);
      if (
        dimensions === null ||
        dimensions.width !== file.expected.image.width ||
        dimensions.height !== file.expected.image.height
      ) {
        errors.push(
          `${pack.id}/${file.id}: expected ${file.expected.image.width}x${file.expected.image.height} PNG`,
        );
      }
    }
    if (file.spriteSheet !== null && file.expected.image !== null) {
      const requiredWidth = file.spriteSheet.frameWidth * file.spriteSheet.columns;
      const requiredHeight = file.spriteSheet.frameHeight * file.spriteSheet.rows;
      if (
        requiredWidth > file.expected.image.width ||
        requiredHeight > file.expected.image.height ||
        file.spriteSheet.frameCount > file.spriteSheet.columns * file.spriteSheet.rows
      ) {
        errors.push(`${pack.id}/${file.id}: sprite sheet grid exceeds image bounds`);
      }
    }
  }
}
await validateTrackedPaths(errors, warnings);
if (warnings.length > 0) {
  console.warn(`Asset warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}`);
}
if (errors.length > 0) {
  console.error(`Asset validation failed:\n${errors.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${packs.length} asset packs and ${assetIds.size} logical assets.`);
}

function validatePolicy(pack, output) {
  const policy = pack.license.repositoryPolicy;
  if (pack.source.kind === "repository" && policy !== "allowed") {
    output.push(`${pack.id}: repository source requires repositoryPolicy=allowed`);
  }
  if (
    pack.source.kind === "local-directory" &&
    !pack.source.directory.startsWith(".local/assets/")
  ) {
    output.push(`${pack.id}: local-directory must be stored under .local/assets`);
  }
  if (pack.source.kind === "external" && pack.delivery.kind !== "external") {
    output.push(`${pack.id}: external source requires external delivery`);
  }
  if (pack.source.kind === "git-lfs" && policy !== "allowed" && policy !== "git-lfs-only") {
    output.push(`${pack.id}: git-lfs source is forbidden by its license policy`);
  }
  if (
    (pack.source.kind === "repository" || pack.source.kind === "git-lfs") &&
    pack.ownership === "third-party" &&
    pack.license.redistribution !== "allowed"
  ) {
    output.push(`${pack.id}: third-party files cannot be committed without redistribution=allowed`);
  }
  if (
    policy === "forbidden" &&
    (pack.source.kind === "repository" || pack.source.kind === "git-lfs")
  ) {
    output.push(`${pack.id}: forbidden pack cannot use a tracked source`);
  }
  if (
    pack.required &&
    pack.environments.some((environment) => environment !== "local") &&
    pack.license.deploymentPolicy !== "allowed"
  ) {
    output.push(`${pack.id}: required non-local pack must have deploymentPolicy=allowed`);
  }
  if (pack.license.attributionRequired && pack.license.attributionText === null) {
    output.push(`${pack.id}: attributionText is required`);
  }
}

async function validateTrackedPaths(output, warningOutput) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: repositoryRoot,
      encoding: "buffer",
    });
    const tracked = stdout.toString("utf8").split("\0").filter(Boolean);
    for (const file of tracked) {
      if (
        file.startsWith(".local/assets/") ||
        file.startsWith("apps/activity/public/assets/generated/")
      ) {
        output.push(`${file}: generated or private asset must not be tracked by Git`);
      }
    }
    const lfsAttributes = join(repositoryRoot, ".gitattributes");
    if (
      tracked.some((file) => file.startsWith("assets/repository-lfs/")) &&
      !(await pathExists(lfsAttributes))
    ) {
      output.push("assets/repository-lfs contains tracked files but .gitattributes is missing");
    }
  } catch {
    warningOutput.push("Git repository not initialized; tracked-file policy check was skipped");
  }
}
