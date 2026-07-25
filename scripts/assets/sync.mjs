import { installArchive } from "./archive.mjs";
import { loadPackManifests, pathExists, installedPackRoot } from "./lib.mjs";

const packFlagIndex = process.argv.indexOf("--pack");
const requestedPackId = packFlagIndex >= 0 ? process.argv[packFlagIndex + 1] : undefined;
const force = process.argv.includes("--force");
const packs = (await loadPackManifests())
  .map(({ manifest }) => manifest)
  .filter((pack) => pack.source.kind === "remote-archive")
  .filter((pack) => requestedPackId === undefined || pack.id === requestedPackId);
if (packs.length === 0) {
  console.log("No matching remote archive packs.");
}
for (const pack of packs) {
  if (!force && (await pathExists(installedPackRoot(pack)))) {
    console.log(`Skipped ${pack.id}; already installed.`);
    continue;
  }
  const response = await fetch(pack.source.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${pack.id}: HTTP ${response.status}`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  await installArchive(
    pack,
    archive,
    new URL(pack.source.url).pathname.split("/").pop() ?? `${pack.id}.zip`,
  );
  console.log(`Synchronized ${pack.displayName}.`);
}
