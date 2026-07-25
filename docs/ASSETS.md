# Asset management

Discord Hero treats asset identity, source storage, license policy, and runtime delivery as separate concerns. Game code references logical IDs such as `character.soldier.idle`; it never depends on a source archive name or repository path.

## Supported asset kinds

- `image`: a single image
- `sprite-sheet`: frame-based animation metadata plus an image
- `audio`: music, ambience, or sound effects
- `font`: web font files and font metadata
- `data`: JSON, text, CSV, or other data
- `binary`: files interpreted by a feature-specific loader

## Supported source strategies

| Source kind       | Storage                                |            Git tracking | Typical use                                                |
| ----------------- | -------------------------------------- | ----------------------: | ---------------------------------------------------------- |
| `repository`      | `assets/repository/<pack>`             |                     Yes | Project-owned or redistributable small assets              |
| `git-lfs`         | `assets/repository-lfs/<pack>`         |                 Git LFS | Redistributable large images, audio, and models            |
| `local-directory` | `.local/assets/directories/<pack>`     |                      No | Unpacked private assets or editor-managed source folders   |
| `local-archive`   | `.local/assets/packs/<pack>/<version>` |                      No | Purchased, private, or redistribution-restricted packs     |
| `remote-archive`  | Downloaded into `.local/assets`        |                      No | Versioned vendor archives or private build storage         |
| `external`        | CDN or object storage                  | No binary in repository | Large production assets and independently deployed content |
| `generated`       | `assets/generated-sources/<pack>`      |       Depends on policy | Outputs produced by deterministic asset tools              |

A pack manifest can use `bundle` delivery to copy and fingerprint files into the Activity build, or `external` delivery to keep runtime URLs on a CDN or R2 domain.

## Directory layout

```text
assets/
├─ asset-pack.schema.json
├─ packs/<pack-id>/asset-pack.json
├─ repository/             # normal Git assets
├─ repository-lfs/         # Git LFS assets
└─ generated-sources/      # deterministic source outputs

.local/assets/
└─ packs/<pack-id>/<version>/  # private or downloaded sources

apps/activity/public/assets/generated/
├─ asset-catalog.json
├─ THIRD_PARTY_NOTICES.txt
└─ <pack-id>/...<content-hash>.<extension>
```

`.local/assets` and `apps/activity/public/assets/generated` are ignored by Git. The generated public directory is reproducible build output and must not be committed.

## Commands

```bash
# Show registered packs and installation status
npm run assets:list

# Install a local ZIP and match it by file name or SHA-256
npm run assets:install -- "path/to/asset-pack.zip"

# Download registered remote archives and verify their SHA-256
npm run assets:sync

# Validate manifests, dimensions, checksums, license policy, and Git tracking
npm run assets:validate

# Build the local runtime catalog and fingerprinted public files
npm run assets:prepare:local

# Build environment-specific catalogs
npm run assets:prepare:staging
npm run assets:prepare:production

# Create a project-owned pack manifest
npm run assets:pack -- my-pack
```

`npm run dev`, `npm run build`, `npm run check`, and `npm run agent:verify` invoke the relevant asset preparation or validation automatically.

## Adding a Git-tracked asset pack

1. Create a manifest with `npm run assets:pack -- <pack-id>`.
2. Put files in `assets/repository/<pack-id>`.
3. Keep `source.kind` as `repository`.
4. Record the actual license and set `redistribution` and `repositoryPolicy` accurately.
5. Add logical file entries, expected image dimensions, and sprite metadata.
6. Run `npm run assets:validate` and `npm run assets:prepare:local`.

Third-party files may use normal Git only when redistribution is explicitly allowed. Project-owned assets may use the `Project-owned` policy.

## Adding a Git LFS pack

1. Install Git LFS in the development environment.
2. Put the files in `assets/repository-lfs/<pack-id>`.
3. Set `source.kind` to `git-lfs`.
4. Set `repositoryPolicy` to `git-lfs-only` or `allowed`.
5. Confirm `git lfs ls-files` contains the intended files.

`.gitattributes` already routes `assets/repository-lfs/**` through Git LFS.

## Adding a private or purchased archive

Register a `local-archive` manifest with exact archive names, root directory, and SHA-256. Do not copy the archive into tracked directories.

```bash
npm run assets:install -- ".local/assets/archives/vendor-pack.zip"
npm run assets:prepare:local
```

The pack can be optional so CI and open-source clones still build with fallback visuals. For production, provide the archive to the build environment, use a private `remote-archive`, or publish game-ready files to an approved external delivery location.

## Remote and external delivery

`remote-archive` downloads a versioned ZIP during an explicit `assets:sync` step and verifies its SHA-256 before extraction. Avoid mutable URLs without immutable checksums.

`external` delivery writes the CDN or R2 URL into the runtime catalog. Use content-versioned URLs and configure CORS for the Discord Activity origin. External delivery is appropriate for large audio, video, models, and content updated independently from application deploys.

## License and repository safeguards

Every pack records:

- ownership
- license name and optional SPDX identifier
- redistribution status
- modification status
- repository policy
- deployment policy
- attribution requirement and text

`assets:validate` rejects tracked third-party sources unless redistribution is allowed. It also rejects private/generated output if Git tracks it. An unknown license defaults to a conservative repository policy and a non-production deployment policy.

The current Tiny RPG Soldier & Orc pack is registered as `local-archive` with `repositoryPolicy=forbidden` and `deploymentPolicy=allowed`: it may be used and modified inside personal or commercial games, but the asset files may not be redistributed, resold, or re-uploaded as assets. Credit is optional.

## Runtime behavior

The client loads `/assets/generated/asset-catalog.json` and validates it with `@discord-hero/assets`. PixiJS slices sprite sheets using manifest metadata. Missing optional packs, failed image requests, or an absent catalog do not prevent startup; the renderer uses geometric fallback visuals.

Asset URLs include a SHA-256-derived filename segment, allowing long-lived immutable caching without stale-file collisions.
