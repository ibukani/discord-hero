import { describe, expect, it } from "vitest";
import { createEmptyAssetCatalog, parseAssetCatalog } from "../src/index.js";

describe("asset catalog", () => {
  it("parses an empty generated catalog", () => {
    expect(parseAssetCatalog(createEmptyAssetCatalog("local"))).toEqual({
      schemaVersion: 1,
      mode: "local",
      packs: [],
      assets: {},
    });
  });

  it("rejects an invalid sprite frame count", () => {
    expect(() =>
      parseAssetCatalog({
        schemaVersion: 1,
        mode: "production",
        packs: [],
        assets: {
          "character.invalid.idle": {
            id: "character.invalid.idle",
            packId: "invalid-pack",
            kind: "sprite-sheet",
            mediaType: "image/png",
            url: "/invalid.png",
            sha256: null,
            byteLength: null,
            pixelArt: true,
            image: { width: 100, height: 100 },
            spriteSheet: {
              frameWidth: 100,
              frameHeight: 100,
              frameCount: 0,
              columns: 1,
              rows: 1,
              frameDurationMs: 100,
              loop: true,
              anchor: { x: 0.5, y: 0.5 },
            },
          },
        },
      }),
    ).toThrow();
  });
});
