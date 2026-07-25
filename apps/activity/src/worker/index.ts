import {
  AuthResponseSchema,
  DiscordTokenExchangeRequestSchema,
  HealthResponseSchema,
  LocalAuthRequestSchema,
  RoomIdSchema,
  RoomTicketRequestSchema,
  RoomTicketResponseSchema,
} from "@discord-hero/protocol";
import { z } from "zod";
import { exchangeDiscordCode } from "./auth/discord.js";
import {
  issueRoomTicket,
  issueSessionToken,
  verifySessionToken,
  type SessionClaims,
} from "./auth/tokens.js";
import { GameRoom } from "./durable-objects/GameRoom.js";
import type { Env } from "./env.js";
import { HttpBodyError, readJsonBody } from "./http/body.js";
import { bearerToken, isLocalHost, requestId } from "./http/request.js";
import { errorResponse, jsonResponse, withSecurityHeaders } from "./http/responses.js";
import { createLogger, normalizeError } from "./observability/logger.js";
import { upsertPlayer } from "./persistence/player-repository.js";
import { consumeMatchResults } from "./queue/consumer.js";

export { GameRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId(request);
    const logger = createLogger(env.APP_ENV);
    const startedAt = performance.now();

    try {
      const response = await routeRequest(request, env, id);
      logger.info({
        event: "http_request_completed",
        requestId: id,
        durationMs: performance.now() - startedAt,
        details: {
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
        },
      });
      return response;
    } catch (error: unknown) {
      const normalized = normalizeError(error);
      logger.error({
        event: "http_request_failed",
        requestId: id,
        durationMs: performance.now() - startedAt,
        errorCode: normalized.name,
        details: { message: normalized.message },
      });

      if (error instanceof HttpBodyError || error instanceof z.ZodError) {
        return errorResponse(400, "bad_request", "Invalid request", id);
      }
      return errorResponse(500, "internal_error", "Internal server error", id);
    }
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await consumeMatchResults(batch, env);
  },
} satisfies ExportedHandler<Env>;

async function routeRequest(request: Request, env: Env, id: string): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse(
      HealthResponseSchema.parse({
        status: "ok",
        environment: env.APP_ENV,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/auth/discord/exchange") {
    return handleDiscordAuth(request, env, id);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/local") {
    return handleLocalAuth(request, env, id);
  }

  if (request.method === "POST" && url.pathname === "/api/rooms/ticket") {
    return handleRoomTicket(request, env, id);
  }

  if (request.method === "GET" && /^\/api\/rooms\/[^/]+\/socket$/u.test(url.pathname)) {
    return forwardRoomSocket(request, env, id);
  }

  if (url.pathname.startsWith("/api/")) {
    return errorResponse(404, "not_found", "API route not found", id);
  }

  const assetResponse = await env.ASSETS.fetch(request);
  return withSecurityHeaders(assetResponse);
}

async function handleDiscordAuth(request: Request, env: Env, id: string): Promise<Response> {
  if (env.APP_ENV === "local" && env.DISCORD_CLIENT_SECRET.length === 0) {
    return errorResponse(503, "internal_error", "Discord authentication is not configured", id);
  }

  const input = DiscordTokenExchangeRequestSchema.parse(await readJsonBody(request));
  const identity = await exchangeDiscordCode(
    input.code,
    env.DISCORD_CLIENT_ID,
    env.DISCORD_CLIENT_SECRET,
  );
  const now = new Date();
  await upsertPlayer(env.DB, {
    id: identity.userId,
    discordUserId: identity.userId,
    displayName: identity.displayName,
    now: now.toISOString(),
  });
  const sessionToken = await issueSessionToken(
    identity.userId,
    identity.displayName,
    env.SESSION_SIGNING_SECRET,
    now,
  );

  return jsonResponse(
    AuthResponseSchema.parse({
      sessionToken,
      discordAccessToken: identity.accessToken,
      user: {
        id: identity.userId,
        displayName: identity.displayName,
      },
    }),
  );
}

async function handleLocalAuth(request: Request, env: Env, id: string): Promise<Response> {
  if (env.APP_ENV !== "local" || env.ALLOW_LOCAL_AUTH !== "true" || !isLocalHost(request)) {
    return errorResponse(404, "not_found", "API route not found", id);
  }

  const input = LocalAuthRequestSchema.parse(await readJsonBody(request));
  const localUserId = `local:${input.userId}`;
  const now = new Date();
  await upsertPlayer(env.DB, {
    id: localUserId,
    discordUserId: null,
    displayName: input.displayName,
    now: now.toISOString(),
  });
  const sessionToken = await issueSessionToken(
    localUserId,
    input.displayName,
    env.SESSION_SIGNING_SECRET,
    now,
  );

  return jsonResponse(
    AuthResponseSchema.parse({
      sessionToken,
      discordAccessToken: null,
      user: {
        id: localUserId,
        displayName: input.displayName,
      },
    }),
  );
}

async function handleRoomTicket(request: Request, env: Env, id: string): Promise<Response> {
  const token = bearerToken(request);
  if (token === null) {
    return errorResponse(401, "unauthorized", "Authentication required", id);
  }

  let session: SessionClaims;
  try {
    session = await verifySessionToken(token, env.SESSION_SIGNING_SECRET);
  } catch {
    return errorResponse(401, "unauthorized", "Invalid session", id);
  }

  const input = RoomTicketRequestSchema.parse(await readJsonBody(request));
  const ticket = await issueRoomTicket(session, input.roomId, env.SESSION_SIGNING_SECRET);
  return jsonResponse(
    RoomTicketResponseSchema.parse({
      ticket: ticket.token,
      expiresAt: ticket.expiresAt,
    }),
  );
}

async function forwardRoomSocket(request: Request, env: Env, id: string): Promise<Response> {
  const match = /^\/api\/rooms\/([^/]+)\/socket$/u.exec(new URL(request.url).pathname);
  if (match?.[1] === undefined) {
    return errorResponse(400, "bad_request", "Invalid room path", id);
  }

  let roomId: string;
  try {
    roomId = RoomIdSchema.parse(decodeURIComponent(match[1]));
  } catch {
    return errorResponse(400, "bad_request", "Invalid room identifier", id);
  }

  const canonicalRoomKey = `${env.APP_ENV}:${env.DISCORD_CLIENT_ID}:${roomId}`;
  const objectId = env.GAME_ROOMS.idFromName(canonicalRoomKey);
  return env.GAME_ROOMS.get(objectId).fetch(request);
}
