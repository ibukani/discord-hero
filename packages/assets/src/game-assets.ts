export const GAME_VISUAL_ASSET_IDS = {
  soldierIdle: "character.soldier.idle",
  orcIdle: "character.orc.idle",
} as const;

export const KENNEY_UI_ASSET_IDS = {
  tilemapLarge: "kenney.ui.tilemap-large",
  tilemapSmall: "kenney.ui.tilemap-small",
  tile0000: "kenney.ui.tile-0000",
  tile0001: "kenney.ui.tile-0001",
  tile0002: "kenney.ui.tile-0002",
  tile0003: "kenney.ui.tile-0003",
  tile0004: "kenney.ui.tile-0004",
  tile0005: "kenney.ui.tile-0005",
  tile0006: "kenney.ui.tile-0006",
  tile0007: "kenney.ui.tile-0007",
  tile0008: "kenney.ui.tile-0008",
  tile0009: "kenney.ui.tile-0009",
} as const;

export type GameVisualAssetId = (typeof GAME_VISUAL_ASSET_IDS)[keyof typeof GAME_VISUAL_ASSET_IDS];
export type KenneyUiAssetId = (typeof KENNEY_UI_ASSET_IDS)[keyof typeof KENNEY_UI_ASSET_IDS];
