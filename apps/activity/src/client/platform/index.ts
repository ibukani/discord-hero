import { LocalPlatformBridge } from "./local.js";
import type { PlatformBridge, PlatformSession } from "./types.js";

export function createPlatformBridge(): PlatformBridge {
  const requestedMode = import.meta.env.VITE_PLATFORM_MODE ?? "auto";
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const query = new URLSearchParams(window.location.search);
  const appearsEmbedded = query.has("frame_id") || query.has("instance_id");

  if (requestedMode === "discord" || (requestedMode === "auto" && appearsEmbedded)) {
    if (clientId === undefined || clientId.length === 0) {
      throw new Error("VITE_DISCORD_CLIENT_ID is required in Discord mode");
    }
    return new LazyDiscordPlatformBridge(clientId);
  }
  return new LocalPlatformBridge();
}

class LazyDiscordPlatformBridge implements PlatformBridge {
  private delegate: PlatformBridge | null = null;

  public constructor(private readonly clientId: string) {}

  public async initialize(): Promise<PlatformSession> {
    const { DiscordPlatformBridge } = await import("./discord.js");
    const delegate = new DiscordPlatformBridge(this.clientId);
    this.delegate = delegate;
    return delegate.initialize();
  }

  public async invite(): Promise<void> {
    if (this.delegate === null) {
      throw new Error("Discord platform is not initialized");
    }
    await this.delegate.invite();
  }

  public dispose(): void {
    this.delegate?.dispose();
    this.delegate = null;
  }
}

export type { PlatformBridge, PlatformSession, PlatformUser } from "./types.js";
