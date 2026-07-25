import { GAME_WEBSOCKET_PROTOCOL, RoomIdSchema } from "@discord-hero/protocol";
import { z } from "zod";

export const GAME_PROTOCOL = GAME_WEBSOCKET_PROTOCOL;
export const MAX_ROOM_CONNECTIONS = 8;
export const MAX_PLAYER_CONNECTIONS = 2;
export const MESSAGE_RATE_WINDOW_MS = 10_000;
export const MAX_MESSAGES_PER_RATE_WINDOW = 40;

const AUTH_PROTOCOL_PREFIX = "auth.";

export const ConnectionAttachmentSchema = z.object({
  playerId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(48),
  roomId: RoomIdSchema,
  connectedAt: z.iso.datetime(),
  rateWindowStartedAtMs: z.number().int().nonnegative(),
  messagesInWindow: z.number().int().nonnegative(),
  handshakeComplete: z.boolean().default(false),
});

export type ConnectionAttachment = z.infer<typeof ConnectionAttachmentSchema>;

export function readConnectionAttachment(socket: WebSocket): ConnectionAttachment | null {
  const parsed = ConnectionAttachmentSchema.safeParse(socket.deserializeAttachment());
  return parsed.success ? parsed.data : null;
}

export function roomIdFromSocketUrl(urlValue: string): string | null {
  const path = new URL(urlValue).pathname;
  const match = /^\/api\/rooms\/([^/]+)\/socket$/u.exec(path);
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    return RoomIdSchema.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function ticketFromProtocols(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const protocols = header.split(",").map((protocol) => protocol.trim());
  if (!protocols.includes(GAME_PROTOCOL)) {
    return null;
  }
  const authProtocol = protocols.find((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  return authProtocol?.slice(AUTH_PROTOCOL_PREFIX.length) ?? null;
}

export function countPlayerConnections(sockets: readonly WebSocket[], playerId: string): number {
  return sockets.reduce((count, socket) => {
    const attachment = readConnectionAttachment(socket);
    return attachment?.playerId === playerId ? count + 1 : count;
  }, 0);
}
