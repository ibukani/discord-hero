import {
  cleanGeneratedAssets,
  copyWithHashedName,
  loadPackManifests,
  pathExists,
  readPngDimensions,
  resolveInside,
  sourceRootFor,
  writeGeneratedFile,
} from "./lib.mjs";

const modeFlagIndex = process.argv.indexOf("--mode");
const mode = modeFlagIndex >= 0 ? process.argv[modeFlagIndex + 1] : "local";
if (!["local", "staging", "production"].includes(mode)) {
  throw new Error(`Unsupported asset mode: ${mode}`);
}
await cleanGeneratedAssets();
const packs = await loadPackManifests();
const catalog = { schemaVersion: 1, mode, packs: [], assets: {} };
const notices = [];
const warnings = [];
for (const { manifest: pack } of packs) {
  if (!pack.environments.includes(mode)) {
    continue;
  }
  if (mode !== "local" && pack.license.deploymentPolicy !== "allowed") {
    const message = `${pack.id}: deployment policy ${pack.license.deploymentPolicy} does not allow ${mode}`;
    if (pack.required) {
      throw new Error(message);
    }
    warnings.push(message);
    continue;
  }
  const sourceRoot = sourceRootFor(pack);
  const resolvedFiles = [];
  let missing = false;
  for (const file of pack.files) {
    if (pack.delivery.kind === "external") {
      resolvedFiles.push({ file, sourcePath: null });
      continue;
    }
    if (sourceRoot === null) {
      throw new Error(`${pack.id}: bundle delivery requires a local source root`);
    }
    const sourcePath = resolveInside(sourceRoot, file.sourcePath, `${pack.id}.${file.id}`);
    if (!(await pathExists(sourcePath))) {
      missing = true;
      break;
    }
    resolvedFiles.push({ file, sourcePath });
  }
  if (missing) {
    const message = `${pack.id}: source files are not installed`;
    if (pack.required) {
      throw new Error(message);
    }
    warnings.push(message);
    continue;
  }
  catalog.packs.push({
    id: pack.id,
    version: pack.version,
    displayName: pack.displayName,
    ownership: pack.ownership,
    licenseName: pack.license.name,
    attributionText: pack.license.attributionText,
  });
  if (pack.license.attributionRequired && pack.license.attributionText !== null) {
    notices.push(`${pack.displayName}\n${pack.license.attributionText}`);
  }
  for (const { file, sourcePath } of resolvedFiles) {
    const runtime = await createRuntimeAsset(pack, file, sourcePath);
    if (catalog.assets[file.id] !== undefined) {
      throw new Error(`Duplicate runtime asset id: ${file.id}`);
    }
    catalog.assets[file.id] = runtime;
  }
}
await writeGeneratedFile("asset-catalog.json", `${JSON.stringify(catalog, null, 2)}\n`);
await writeGeneratedFile(
  "THIRD_PARTY_NOTICES.txt",
  notices.length === 0 ? "No runtime attribution notices.\n" : `${notices.join("\n\n---\n\n")}\n`,
);
if (warnings.length > 0) {
  console.warn(`Asset preparation warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}`);
}
console.log(
  `Prepared ${Object.keys(catalog.assets).length} assets from ${catalog.packs.length} packs for ${mode}.`,
);

async function createRuntimeAsset(pack, file, sourcePath) {
  let url;
  let sha256 = null;
  let byteLength = null;
  let dimensions = null;
  if (pack.delivery.kind === "external") {
    const relativeUrl = file.externalUrl ?? file.outputPath;
    url = /^https?:\/\//u.test(relativeUrl)
      ? relativeUrl
      : `${pack.delivery.baseUrl}/${relativeUrl.replace(/^\//u, "")}`;
  } else {
    if (sourcePath === null) {
      throw new Error(`${pack.id}/${file.id}: source path missing`);
    }
    const copied = await copyWithHashedName(sourcePath, file.outputPath, pack.delivery.publicPath);
    url = copied.publicUrl;
    sha256 = copied.hash;
    byteLength = copied.byteLength;
    if (file.mediaType === "image/png") {
      dimensions = await readPngDimensions(sourcePath);
    }
  }
  const base = {
    id: file.id,
    packId: pack.id,
    kind: file.kind,
    mediaType: file.mediaType,
    url,
    sha256,
    byteLength,
  };
  switch (file.kind) {
    case "image":
      return { ...base, pixelArt: file.pixelArt, image: dimensions ?? file.expected.image };
    case "sprite-sheet":
      if (file.spriteSheet === null) {
        throw new Error(`${pack.id}/${file.id}: sprite metadata missing`);
      }
      if ((dimensions ?? file.expected.image) === null) {
        throw new Error(`${pack.id}/${file.id}: image dimensions missing`);
      }
      return {
        ...base,
        pixelArt: file.pixelArt,
        image: dimensions ?? file.expected.image,
        spriteSheet: file.spriteSheet,
      };
    case "font":
      if (file.font === null) {
        throw new Error(`${pack.id}/${file.id}: font metadata missing`);
      }
      return { ...base, font: file.font };
    case "data":
      if (file.data === null) {
        throw new Error(`${pack.id}/${file.id}: data metadata missing`);
      }
      return { ...base, data: file.data };
    case "audio":
    case "binary":
      return base;
  }
}
