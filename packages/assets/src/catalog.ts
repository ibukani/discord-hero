import { z } from "zod";

const assetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/u);
const packIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const urlSchema = z.string().min(1);

const imageMetadataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const spriteSheetMetadataSchema = z.object({
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  frameCount: z.number().int().positive(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  frameDurationMs: z.number().int().positive(),
  loop: z.boolean(),
  anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
});

const baseRuntimeAssetSchema = z.object({
  id: assetIdSchema,
  packId: packIdSchema,
  mediaType: z.string().min(3),
  url: urlSchema,
  sha256: sha256Schema.nullable(),
  byteLength: z.number().int().nonnegative().nullable(),
});

export const runtimeAssetSchema = z.discriminatedUnion("kind", [
  baseRuntimeAssetSchema.extend({
    kind: z.literal("image"),
    pixelArt: z.boolean(),
    image: imageMetadataSchema.nullable(),
  }),
  baseRuntimeAssetSchema.extend({
    kind: z.literal("sprite-sheet"),
    pixelArt: z.boolean(),
    image: imageMetadataSchema,
    spriteSheet: spriteSheetMetadataSchema,
  }),
  baseRuntimeAssetSchema.extend({ kind: z.literal("audio") }),
  baseRuntimeAssetSchema.extend({
    kind: z.literal("font"),
    font: z.object({
      family: z.string().min(1),
      weight: z.string().min(1),
      style: z.string().min(1),
    }),
  }),
  baseRuntimeAssetSchema.extend({
    kind: z.literal("data"),
    data: z.object({ format: z.enum(["json", "text", "csv", "other"]) }),
  }),
  baseRuntimeAssetSchema.extend({ kind: z.literal("binary") }),
]);

export const assetCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["local", "staging", "production"]),
  packs: z.array(
    z.object({
      id: packIdSchema,
      version: z.string().min(1),
      displayName: z.string().min(1),
      ownership: z.enum(["project", "third-party", "generated"]),
      licenseName: z.string().min(1),
      attributionText: z.string().nullable(),
    }),
  ),
  assets: z.record(assetIdSchema, runtimeAssetSchema),
});

export type RuntimeAsset = z.infer<typeof runtimeAssetSchema>;
export type SpriteSheetRuntimeAsset = Extract<RuntimeAsset, { readonly kind: "sprite-sheet" }>;
export type AssetCatalog = z.infer<typeof assetCatalogSchema>;

export function parseAssetCatalog(input: unknown): AssetCatalog {
  return assetCatalogSchema.parse(input);
}

export function createEmptyAssetCatalog(mode: AssetCatalog["mode"]): AssetCatalog {
  return { schemaVersion: 1, mode, packs: [], assets: {} };
}
