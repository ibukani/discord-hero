import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const packsRoot = join(repositoryRoot, "assets/packs");
export const localAssetsRoot = join(repositoryRoot, ".local/assets");
export const generatedPublicRoot = join(repositoryRoot, "apps/activity/public/assets/generated");

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

export function requireStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value;
}

export function safeRelativePath(value, label) {
  const candidate = requireString(value, label).replaceAll("\\", "/");
  if (
    candidate.startsWith("/") ||
    candidate.includes("../") ||
    candidate === ".." ||
    /^[A-Za-z]:/u.test(candidate)
  ) {
    throw new Error(`${label} must stay inside its asset root: ${candidate}`);
  }
  return candidate;
}

export function resolveInside(root, relativePath, label) {
  const safe = safeRelativePath(relativePath, label);
  const target = resolve(root, safe);
  const normalizedRoot = `${normalize(root)}${sep}`;
  if (target !== normalize(root) && !`${normalize(target)}${sep}`.startsWith(normalizedRoot)) {
    throw new Error(`${label} escapes its asset root`);
  }
  return target;
}

export async function loadPackManifests() {
  if (!(await pathExists(packsRoot))) {
    return [];
  }
  const entries = await readdir(packsRoot, { withFileTypes: true });
  const packs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = join(packsRoot, entry.name, "asset-pack.json");
    if (!(await pathExists(manifestPath))) {
      continue;
    }
    const manifest = parsePackManifest(await readJson(manifestPath), manifestPath);
    packs.push({ manifestPath, directory: dirname(manifestPath), manifest });
  }
  return packs.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

export function parsePackManifest(input, manifestPath = "asset-pack.json") {
  if (!isRecord(input) || input.schemaVersion !== 1) {
    throw new Error(`${manifestPath}: unsupported schemaVersion`);
  }
  const id = requireString(input.id, `${manifestPath}.id`);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(id)) {
    throw new Error(`${manifestPath}.id has an invalid format`);
  }
  const version = requireString(input.version, `${manifestPath}.version`);
  const displayName = requireString(input.displayName, `${manifestPath}.displayName`);
  const environments = requireStringArray(input.environments, `${manifestPath}.environments`);
  for (const environment of environments) {
    if (!["local", "staging", "production"].includes(environment)) {
      throw new Error(`${manifestPath}.environments contains ${environment}`);
    }
  }
  const required = requireBoolean(input.required, `${manifestPath}.required`);
  if (!["project", "third-party", "generated"].includes(input.ownership)) {
    throw new Error(`${manifestPath}.ownership is invalid`);
  }
  const license = parseLicense(input.license, manifestPath);
  const source = parseSource(input.source, manifestPath);
  const delivery = parseDelivery(input.delivery, manifestPath);
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new Error(`${manifestPath}.files must contain at least one asset`);
  }
  const files = input.files.map((file, index) =>
    parseFile(file, `${manifestPath}.files[${index}]`),
  );
  return {
    schemaVersion: 1,
    id,
    version,
    displayName,
    description: typeof input.description === "string" ? input.description : "",
    environments,
    required,
    ownership: input.ownership,
    license,
    source,
    delivery,
    files,
  };
}

function parseLicense(input, manifestPath) {
  if (!isRecord(input)) {
    throw new Error(`${manifestPath}.license must be an object`);
  }
  const redistribution = requireString(
    input.redistribution,
    `${manifestPath}.license.redistribution`,
  );
  const modification = requireString(input.modification, `${manifestPath}.license.modification`);
  const repositoryPolicy = requireString(
    input.repositoryPolicy,
    `${manifestPath}.license.repositoryPolicy`,
  );
  const deploymentPolicy = requireString(
    input.deploymentPolicy,
    `${manifestPath}.license.deploymentPolicy`,
  );
  if (!["allowed", "prohibited", "unknown"].includes(redistribution)) {
    throw new Error(`${manifestPath}.license.redistribution is invalid`);
  }
  if (!["allowed", "prohibited", "unknown"].includes(modification)) {
    throw new Error(`${manifestPath}.license.modification is invalid`);
  }
  if (!["allowed", "git-lfs-only", "forbidden"].includes(repositoryPolicy)) {
    throw new Error(`${manifestPath}.license.repositoryPolicy is invalid`);
  }
  if (!["allowed", "local-only", "prohibited", "unknown"].includes(deploymentPolicy)) {
    throw new Error(`${manifestPath}.license.deploymentPolicy is invalid`);
  }
  const attributionRequired = requireBoolean(
    input.attributionRequired,
    `${manifestPath}.license.attributionRequired`,
  );
  return {
    name: requireString(input.name, `${manifestPath}.license.name`),
    spdx: typeof input.spdx === "string" ? input.spdx : null,
    sourceUrl: typeof input.sourceUrl === "string" ? input.sourceUrl : null,
    redistribution,
    modification,
    repositoryPolicy,
    deploymentPolicy,
    attributionRequired,
    attributionText: typeof input.attributionText === "string" ? input.attributionText : null,
    notes: typeof input.notes === "string" ? input.notes : null,
  };
}

function parseSource(input, manifestPath) {
  if (!isRecord(input)) {
    throw new Error(`${manifestPath}.source must be an object`);
  }
  const kind = requireString(input.kind, `${manifestPath}.source.kind`);
  switch (kind) {
    case "repository":
    case "git-lfs":
    case "local-directory":
    case "generated":
      return {
        kind,
        directory: safeRelativePath(input.directory, `${manifestPath}.source.directory`),
      };
    case "local-archive":
      return {
        kind,
        archiveNames: requireStringArray(input.archiveNames, `${manifestPath}.source.archiveNames`),
        archiveRoot: safeRelativePath(input.archiveRoot, `${manifestPath}.source.archiveRoot`),
        sha256: parseSha256(input.sha256, `${manifestPath}.source.sha256`),
      };
    case "remote-archive":
      return {
        kind,
        url: requireString(input.url, `${manifestPath}.source.url`),
        archiveRoot: safeRelativePath(input.archiveRoot, `${manifestPath}.source.archiveRoot`),
        sha256: parseSha256(input.sha256, `${manifestPath}.source.sha256`),
      };
    case "external":
      return { kind };
    default:
      throw new Error(`${manifestPath}.source.kind is unsupported: ${kind}`);
  }
}

function parseDelivery(input, manifestPath) {
  if (!isRecord(input)) {
    throw new Error(`${manifestPath}.delivery must be an object`);
  }
  const kind = requireString(input.kind, `${manifestPath}.delivery.kind`);
  if (kind === "bundle") {
    return {
      kind,
      publicPath: safeRelativePath(input.publicPath, `${manifestPath}.delivery.publicPath`),
    };
  }
  if (kind === "external") {
    return {
      kind,
      baseUrl: requireString(input.baseUrl, `${manifestPath}.delivery.baseUrl`).replace(/\/$/u, ""),
    };
  }
  throw new Error(`${manifestPath}.delivery.kind is unsupported: ${kind}`);
}

function parseFile(input, label) {
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object`);
  }
  const id = requireString(input.id, `${label}.id`);
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(id)) {
    throw new Error(`${label}.id has an invalid format`);
  }
  const kind = requireString(input.kind, `${label}.kind`);
  if (!["image", "sprite-sheet", "audio", "font", "data", "binary"].includes(kind)) {
    throw new Error(`${label}.kind is unsupported`);
  }
  const file = {
    id,
    kind,
    mediaType: requireString(input.mediaType, `${label}.mediaType`),
    sourcePath: safeRelativePath(input.sourcePath, `${label}.sourcePath`),
    outputPath: safeRelativePath(input.outputPath, `${label}.outputPath`),
    externalUrl: typeof input.externalUrl === "string" ? input.externalUrl : null,
    pixelArt: typeof input.pixelArt === "boolean" ? input.pixelArt : false,
    expected: parseExpected(input.expected, label),
    spriteSheet: parseSpriteSheet(input.spriteSheet, kind, label),
    font: parseFont(input.font, kind, label),
    data: parseData(input.data, kind, label),
  };
  return file;
}

function parseExpected(input, label) {
  if (input === undefined) {
    return { sha256: null, image: null };
  }
  if (!isRecord(input)) {
    throw new Error(`${label}.expected must be an object`);
  }
  let image = null;
  if (input.image !== undefined) {
    if (
      !isRecord(input.image) ||
      !Number.isInteger(input.image.width) ||
      !Number.isInteger(input.image.height) ||
      input.image.width <= 0 ||
      input.image.height <= 0
    ) {
      throw new Error(`${label}.expected.image is invalid`);
    }
    image = { width: input.image.width, height: input.image.height };
  }
  return {
    sha256:
      typeof input.sha256 === "string"
        ? parseSha256(input.sha256, `${label}.expected.sha256`)
        : null,
    image,
  };
}

function parseSpriteSheet(input, kind, label) {
  if (kind !== "sprite-sheet") {
    return null;
  }
  if (!isRecord(input)) {
    throw new Error(`${label}.spriteSheet is required`);
  }
  const integerFields = [
    "frameWidth",
    "frameHeight",
    "frameCount",
    "columns",
    "rows",
    "frameDurationMs",
  ];
  for (const field of integerFields) {
    if (!Number.isInteger(input[field]) || input[field] <= 0) {
      throw new Error(`${label}.spriteSheet.${field} must be a positive integer`);
    }
  }
  if (
    !isRecord(input.anchor) ||
    typeof input.anchor.x !== "number" ||
    typeof input.anchor.y !== "number" ||
    input.anchor.x < 0 ||
    input.anchor.x > 1 ||
    input.anchor.y < 0 ||
    input.anchor.y > 1
  ) {
    throw new Error(`${label}.spriteSheet.anchor is invalid`);
  }
  return {
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    frameCount: input.frameCount,
    columns: input.columns,
    rows: input.rows,
    frameDurationMs: input.frameDurationMs,
    loop: requireBoolean(input.loop, `${label}.spriteSheet.loop`),
    anchor: { x: input.anchor.x, y: input.anchor.y },
  };
}

function parseFont(input, kind, label) {
  if (kind !== "font") {
    return null;
  }
  if (!isRecord(input)) {
    throw new Error(`${label}.font is required`);
  }
  return {
    family: requireString(input.family, `${label}.font.family`),
    weight: requireString(input.weight, `${label}.font.weight`),
    style: requireString(input.style, `${label}.font.style`),
  };
}

function parseData(input, kind, label) {
  if (kind !== "data") {
    return null;
  }
  if (!isRecord(input) || !["json", "text", "csv", "other"].includes(input.format)) {
    throw new Error(`${label}.data is invalid`);
  }
  return { format: input.format };
}

function parseSha256(value, label) {
  const hash = requireString(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return hash;
}

export async function sha256File(path) {
  return sha256Buffer(await readFile(path));
}

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readPngDimensions(path) {
  const handle = await readFile(path);
  if (handle.length < 24 || handle.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return null;
  }
  return { width: handle.readUInt32BE(16), height: handle.readUInt32BE(20) };
}

export function installedPackRoot(pack) {
  return join(localAssetsRoot, "packs", pack.id, pack.version);
}

export function sourceRootFor(pack) {
  switch (pack.source.kind) {
    case "repository":
    case "git-lfs":
    case "local-directory":
    case "generated":
      return resolveInside(repositoryRoot, pack.source.directory, `${pack.id}.source.directory`);
    case "local-archive":
    case "remote-archive":
      return installedPackRoot(pack);
    case "external":
      return null;
  }
}

export async function cleanGeneratedAssets() {
  await rm(generatedPublicRoot, { recursive: true, force: true });
  await mkdir(generatedPublicRoot, { recursive: true });
}

export async function copyWithHashedName(sourcePath, outputRelativePath, packPublicPath) {
  const hash = await sha256File(sourcePath);
  const extension = extname(outputRelativePath);
  const withoutExtension = outputRelativePath.slice(
    0,
    outputRelativePath.length - extension.length,
  );
  const hashedRelativePath =
    `${packPublicPath}/${withoutExtension}.${hash.slice(0, 12)}${extension}`.replaceAll("\\", "/");
  const target = resolveInside(generatedPublicRoot, hashedRelativePath, "generated asset path");
  await mkdir(dirname(target), { recursive: true });
  await copyFile(sourcePath, target);
  const metadata = await stat(sourcePath);
  return { hash, byteLength: metadata.size, publicUrl: `/assets/generated/${hashedRelativePath}` };
}

export async function writeGeneratedFile(relativePath, contents) {
  const target = resolveInside(generatedPublicRoot, relativePath, "generated file path");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

export function archiveCandidatePath(pack, sourcePath) {
  return `${pack.source.archiveRoot}/${sourcePath}`.replaceAll("\\", "/");
}

export function normalizeArchiveEntry(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function displayPath(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

export function archiveDisplayName(path) {
  return basename(path);
}
