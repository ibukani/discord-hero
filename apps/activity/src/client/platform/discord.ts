import { DiscordSDK } from "@discord/embedded-app-sdk";
import { AuthResponseSchema, HeroClassIdSchema, RoomIdSchema } from "@discord-hero/protocol";
import { postJson } from "../api/http.js";
import type { PlatformBridge, PlatformSession } from "./types.js";

export class DiscordPlatformBridge implements PlatformBridge {
  private readonly sdk: DiscordSDK;

  public constructor(private readonly clientId: string) {
    this.sdk = new DiscordSDK(clientId);
  }

  public async initialize(): Promise<PlatformSession> {
    await this.sdk.ready();
    const authorization = await this.sdk.commands.authorize({
      client_id: this.clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"],
    });
    const auth = await postJson(
      "/api/auth/discord/exchange",
      { code: authorization.code },
      AuthResponseSchema,
    );
    if (auth.discordAccessToken === null) {
      throw new Error("Discord access token was not returned");
    }
    await this.sdk.commands.authenticate({
      access_token: auth.discordAccessToken,
    });

    return {
      mode: "discord",
      roomId: RoomIdSchema.parse(this.sdk.instanceId),
      user: auth.user,
      sessionToken: auth.sessionToken,
      initialClassId: HeroClassIdSchema.parse("guardian"),
    };
  }

  public async invite(): Promise<void> {
    await this.sdk.commands.openInviteDialog();
  }

  public dispose(): void {
    return;
  }
}
