import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { unzipSync } from "fflate";
import {
  archiveCandidatePath,
  installedPackRoot,
  normalizeArchiveEntry,
  resolveInside,
  sha256Buffer,
} from "./lib.mjs";

export async function installArchive(pack, archive, archiveName) {
  if (pack.source.kind !== "local-archive" && pack.source.kind !== "remote-archive") {
    throw new Error(`${pack.id} is not archive-backed`);
  }
  const digest = sha256Buffer(archive);
  if (pack.source.sha256 !== digest) {
    throw new Error(
      `Archive checksum mismatch for ${pack.id}. Expected ${pack.source.sha256}, received ${digest}`,
    );
  }
  const extracted = unzipSync(new Uint8Array(archive));
  const normalizedEntries = new Map(
    Object.entries(extracted).map(([name, bytes]) => [normalizeArchiveEntry(name), bytes]),
  );
  const destinationRoot = installedPackRoot(pack);
  await mkdir(destinationRoot, { recursive: true });
  for (const file of pack.files) {
    const archivePathForFile = archiveCandidatePath(pack, file.sourcePath);
    const bytes = normalizedEntries.get(archivePathForFile);
    if (bytes === undefined) {
      throw new Error(`Archive is missing ${archivePathForFile}`);
    }
    const destination = resolveInside(destinationRoot, file.sourcePath, `${pack.id}.${file.id}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  await writeFile(
    resolveInside(destinationRoot, ".install.json", `${pack.id}.install metadata`),
    `${JSON.stringify({ schemaVersion: 1, packId: pack.id, version: pack.version, archiveName, archiveSha256: digest }, null, 2)}\n`,
  );
  return destinationRoot;
}
