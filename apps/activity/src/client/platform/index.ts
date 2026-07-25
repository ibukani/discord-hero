import { DiscordPlatformBridge } from "./discord.js";
import { LocalPlatformBridge } from "./local.js";
import type { PlatformBridge } from "./types.js";

export function createPlatformBridge(): PlatformBridge {
  const requestedMode = import.meta.env.VITE_PLATFORM_MODE ?? "auto";
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const query = new URLSearchParams(window.location.search);
  const appearsEmbedded = query.has("frame_id") || query.has("instance_id");

  if (requestedMode === "discord" || (requestedMode === "auto" && appearsEmbedded)) {
    if (clientId === undefined || clientId.length === 0) {
      throw new Error("VITE_DISCORD_CLIENT_ID is required in Discord mode");
    }
    return new DiscordPlatformBridge(clientId);
  }
  return new LocalPlatformBridge();
}

export type { PlatformBridge, PlatformSession, PlatformUser } from "./types.js";
