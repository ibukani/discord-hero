import { DisplayNameSchema, SafeIdSchema } from "@discord-hero/protocol";
import { z } from "zod";

const DiscordTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string(),
});

const DiscordUserSchema = z.object({
  id: SafeIdSchema,
  username: z.string().min(1).max(64),
  global_name: z.string().max(64).nullable().optional(),
});

export interface DiscordIdentity {
  readonly userId: string;
  readonly displayName: string;
  readonly accessToken: string;
}

export async function exchangeDiscordCode(
  code: string,
  clientId: string,
  clientSecret: string,
  preferredRedirectUri?: string,
): Promise<DiscordIdentity> {
  const candidateRedirectUris = [
    preferredRedirectUri,
    `https://${clientId}.discordsays.com`,
    `https://${clientId}.discordsays.com/`,
  ].filter((uri): uri is string => typeof uri === "string" && uri.length > 0);

  let lastError: DiscordAuthError | null = null;

  for (const redirectUri of candidateRedirectUris) {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      lastError = new DiscordAuthError("token_exchange_failed", tokenResponse.status, details);
      if (details.includes("invalid_grant")) {
        throw lastError;
      }
      continue;
    }

    const tokenPayload = DiscordTokenResponseSchema.parse(await tokenResponse.json());
    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });
    if (!userResponse.ok) {
      const details = await userResponse.text();
      throw new DiscordAuthError("user_fetch_failed", userResponse.status, details);
    }
    const user = DiscordUserSchema.parse(await userResponse.json());
    const displayName = DisplayNameSchema.parse(user.global_name ?? user.username);

    return {
      userId: user.id,
      displayName,
      accessToken: tokenPayload.access_token,
    };
  }

  throw (
    lastError ??
    new DiscordAuthError("token_exchange_failed", 400, "No valid redirect URI succeeded")
  );
}

export class DiscordAuthError extends Error {
  public constructor(
    public readonly code: "token_exchange_failed" | "user_fetch_failed",
    public readonly status: number,
    public readonly details = "",
  ) {
    super(`${code} (${status}): ${details}`);
    this.name = "DiscordAuthError";
  }
}
