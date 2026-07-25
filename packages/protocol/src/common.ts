import { z } from "zod";

export const PROTOCOL_VERSION = 2 as const;
export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);
export const GAME_WEBSOCKET_PROTOCOL = `discord-hero.v${PROTOCOL_VERSION}`;

export const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

export const RoomIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

export const DisplayNameSchema = z.string().trim().min(1).max(48);
export const ActionIdSchema = SafeIdSchema;
export const HeroClassIdSchema = z.enum(["guardian", "ranger", "mage", "support"]);

export const ErrorCodeSchema = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "room_full",
  "rate_limited",
  "unsupported_protocol",
  "unsupported_content",
  "state_recovery_failed",
  "invalid_command",
  "internal_error",
]);

export type HeroClassIdDto = z.infer<typeof HeroClassIdSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
