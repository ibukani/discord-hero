import { type AssetCatalog, type SpriteSheetRuntimeAsset } from "@discord-hero/assets";
import { AnimatedSprite, Assets, Rectangle, Texture } from "pixi.js";
import { loadAssetCatalog } from "./AssetCatalog.js";

export class GameAssetLibrary {
  readonly #catalog: AssetCatalog;
  readonly #textures: ReadonlyMap<string, Texture>;
  readonly #animationFrames: ReadonlyMap<string, readonly Texture[]>;

  private constructor(
    catalog: AssetCatalog,
    textures: ReadonlyMap<string, Texture>,
    animationFrames: ReadonlyMap<string, readonly Texture[]>,
  ) {
    this.#catalog = catalog;
    this.#textures = textures;
    this.#animationFrames = animationFrames;
  }

  static async load(): Promise<GameAssetLibrary> {
    const catalog = await loadCatalog();
    const textures = new Map<string, Texture>();
    const animationFrames = new Map<string, readonly Texture[]>();
    const imageAssets = Object.values(catalog.assets).filter(
      (
        asset,
      ): asset is Extract<
        (typeof catalog.assets)[string],
        { readonly kind: "image" | "sprite-sheet" }
      > => asset.kind === "image" || asset.kind === "sprite-sheet",
    );
    await Promise.all(
      imageAssets.map(async (asset) => {
        try {
          const texture = await Assets.load<Texture>(asset.url);
          if (asset.pixelArt) {
            texture.source.scaleMode = "nearest";
          }
          textures.set(asset.id, texture);
          if (asset.kind === "sprite-sheet") {
            animationFrames.set(asset.id, createFrames(texture, asset));
          }
        } catch (error: unknown) {
          console.warn(`Asset load failed: ${asset.id}`, error);
        }
      }),
    );
    return new GameAssetLibrary(catalog, textures, animationFrames);
  }

  createAnimatedSprite(assetId: string): AnimatedSprite | null {
    const asset = this.#catalog.assets[assetId];
    const frames = this.#animationFrames.get(assetId);
    if (asset?.kind !== "sprite-sheet" || frames === undefined) {
      return null;
    }
    const sprite = new AnimatedSprite([...frames]);
    sprite.loop = asset.spriteSheet.loop;
    sprite.animationSpeed = 1_000 / asset.spriteSheet.frameDurationMs / 60;
    sprite.anchor.set(asset.spriteSheet.anchor.x, asset.spriteSheet.anchor.y);
    if (frames.length > 1) {
      sprite.play();
    }
    return sprite;
  }

  has(assetId: string): boolean {
    return this.#catalog.assets[assetId] !== undefined && this.#textures.has(assetId);
  }
}

function createFrames(texture: Texture, asset: SpriteSheetRuntimeAsset): readonly Texture[] {
  const frames: Texture[] = [];
  for (let index = 0; index < asset.spriteSheet.frameCount; index += 1) {
    const column = index % asset.spriteSheet.columns;
    const row = Math.floor(index / asset.spriteSheet.columns);
    frames.push(
      new Texture({
        source: texture.source,
        frame: new Rectangle(
          column * asset.spriteSheet.frameWidth,
          row * asset.spriteSheet.frameHeight,
          asset.spriteSheet.frameWidth,
          asset.spriteSheet.frameHeight,
        ),
      }),
    );
  }
  return frames;
}

async function loadCatalog(): Promise<AssetCatalog> {
  return loadAssetCatalog();
}
