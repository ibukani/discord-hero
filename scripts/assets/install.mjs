import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installArchive } from "./archive.mjs";
import { archiveDisplayName, loadPackManifests, repositoryRoot, sha256Buffer } from "./lib.mjs";

const archiveArgument = process.argv[2];
if (archiveArgument === undefined) {
  console.error("Usage: npm run assets:install -- <archive.zip> [--pack <pack-id>]");
  process.exit(1);
}
const packFlagIndex = process.argv.indexOf("--pack");
const requestedPackId = packFlagIndex >= 0 ? process.argv[packFlagIndex + 1] : undefined;
const archivePath = resolve(repositoryRoot, archiveArgument);
const archive = await readFile(archivePath);
const digest = sha256Buffer(archive);
const archiveName = archiveDisplayName(archivePath);
const candidates = (await loadPackManifests()).filter(({ manifest }) => {
  if (requestedPackId !== undefined && manifest.id !== requestedPackId) {
    return false;
  }
  if (manifest.source.kind !== "local-archive" && manifest.source.kind !== "remote-archive") {
    return false;
  }
  if (manifest.source.sha256 === digest) {
    return true;
  }
  return (
    manifest.source.kind === "local-archive" && manifest.source.archiveNames.includes(archiveName)
  );
});
if (candidates.length !== 1) {
  const ids = candidates.map(({ manifest }) => manifest.id).join(", ") || "none";
  throw new Error(`Could not uniquely match ${archiveName}. Candidates: ${ids}`);
}
const pack = candidates[0].manifest;
await installArchive(pack, archive, archiveName);
console.log(`Installed ${pack.displayName} to .local/assets/packs/${pack.id}/${pack.version}.`);
