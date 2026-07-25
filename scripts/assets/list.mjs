import { loadPackManifests, pathExists, sourceRootFor } from "./lib.mjs";

const packs = await loadPackManifests();
for (const { manifest: pack } of packs) {
  const root = sourceRootFor(pack);
  const installed = root === null || (await pathExists(root));
  console.log(`${installed ? "✓" : "○"} ${pack.id}@${pack.version}`);
  console.log(
    `  source=${pack.source.kind} delivery=${pack.delivery.kind} policy=${pack.license.repositoryPolicy} files=${pack.files.length}`,
  );
}
