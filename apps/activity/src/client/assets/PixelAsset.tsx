import { type KenneyUiAssetId } from "@discord-hero/assets";
import type { AssetCatalog } from "@discord-hero/assets";
import type { JSX } from "react";

interface PixelAssetProps {
  readonly catalog: AssetCatalog | null;
  readonly assetId: KenneyUiAssetId;
  readonly className?: string;
  readonly label?: string;
}

export function PixelAsset({ catalog, assetId, className, label }: PixelAssetProps): JSX.Element {
  const asset = catalog?.assets[assetId];
  if (asset?.kind !== "image") {
    return <span className={className} aria-hidden="true" />;
  }

  return (
    <img
      className={className}
      src={asset.url}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      draggable={false}
    />
  );
}
