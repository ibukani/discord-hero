import {
  createEmptyAssetCatalog,
  parseAssetCatalog,
  type AssetCatalog,
} from "@discord-hero/assets";

const CATALOG_URL = "/assets/generated/asset-catalog.json";

let catalogPromise: Promise<AssetCatalog> | null = null;

export function loadAssetCatalog(): Promise<AssetCatalog> {
  catalogPromise ??= fetch(CATALOG_URL, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        return createEmptyAssetCatalog(import.meta.env.PROD ? "production" : "local");
      }
      return parseAssetCatalog(await response.json());
    })
    .catch((error: unknown) => {
      console.warn("Asset catalog could not be loaded; using fallback rendering", error);
      return createEmptyAssetCatalog(import.meta.env.PROD ? "production" : "local");
    });
  return catalogPromise;
}
