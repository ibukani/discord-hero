import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packsRoot, pathExists, repositoryRoot } from "./lib.mjs";

const id = process.argv[2];
if (id === undefined || !/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(id)) {
  console.error("Usage: npm run assets:pack -- <pack-id>");
  process.exit(1);
}
const directory = join(packsRoot, id);
const manifestPath = join(directory, "asset-pack.json");
if (await pathExists(manifestPath)) {
  throw new Error(`Asset pack already exists: ${id}`);
}
const sourceDirectory = join(repositoryRoot, "assets/repository", id);
await mkdir(directory, { recursive: true });
await mkdir(sourceDirectory, { recursive: true });
await writeFile(
  join(sourceDirectory, "README.txt"),
  "Replace this placeholder with project-owned or redistributable assets, then update the pack manifest.\n",
);
const manifest = {
  $schema: "../../asset-pack.schema.json",
  schemaVersion: 1,
  id,
  version: "1.0.0",
  displayName: id,
  description: "",
  environments: ["local", "staging", "production"],
  required: false,
  ownership: "project",
  license: {
    name: "Project-owned",
    spdx: null,
    redistribution: "allowed",
    modification: "allowed",
    repositoryPolicy: "allowed",
    deploymentPolicy: "allowed",
    attributionRequired: false,
  },
  source: { kind: "repository", directory: `assets/repository/${id}` },
  delivery: { kind: "bundle", publicPath: id },
  files: [
    {
      id: `${id}.placeholder`,
      kind: "data",
      mediaType: "text/plain",
      sourcePath: "README.txt",
      outputPath: "README.txt",
      data: { format: "text" },
    },
  ],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created a valid scaffold at assets/packs/${id}/asset-pack.json.`);
