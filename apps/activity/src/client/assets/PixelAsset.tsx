import { type RavenUiAssetId, type UiAssetId } from "@discord-hero/assets";
import type { AssetCatalog } from "@discord-hero/assets";
import type { JSX } from "react";

interface PixelAssetProps {
  readonly catalog: AssetCatalog | null;
  readonly assetId: UiAssetId;
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

interface RavenIconProps {
  readonly catalog: AssetCatalog | null;
  readonly assetId: RavenUiAssetId;
  readonly className?: string;
  readonly label?: string;
}

export function RavenIcon({ catalog, assetId, className, label }: RavenIconProps): JSX.Element {
  const mergedClassName =
    className === undefined ? "ui-asset raven-icon" : `ui-asset raven-icon ${className}`;
  if (label === undefined) {
    return <PixelAsset catalog={catalog} assetId={assetId} className={mergedClassName} />;
  }
  return (
    <PixelAsset catalog={catalog} assetId={assetId} className={mergedClassName} label={label} />
  );
}
