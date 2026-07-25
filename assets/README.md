# Asset source registry

This directory contains manifests and sources that are legally permitted to be stored in the repository.

- `packs/`: one versioned manifest per logical asset pack
- `repository/`: normal Git files
- `repository-lfs/`: large files managed by Git LFS
- `generated-sources/`: deterministic source outputs

Private, purchased, or redistribution-restricted files belong under `.local/assets`, not here. See `docs/ASSETS.md`.
