import { z } from "zod";
import { DisplayNameSchema, HeroClassIdSchema, RoomIdSchema, SafeIdSchema } from "./common.js";

export const DiscordTokenExchangeRequestSchema = z.object({
  code: z.string().min(1).max(512),
});

export const LocalAuthRequestSchema = z.object({
  userId: SafeIdSchema,
  displayName: DisplayNameSchema,
  classId: HeroClassIdSchema.default("guardian"),
});

export const AuthResponseSchema = z.object({
  sessionToken: z.string().min(1),
  discordAccessToken: z.string().min(1).nullable(),
  user: z.object({
    id: SafeIdSchema,
    displayName: DisplayNameSchema,
  }),
});

export const RoomTicketRequestSchema = z.object({
  roomId: RoomIdSchema,
});

export const RoomTicketResponseSchema = z.object({
  ticket: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  environment: z.enum(["local", "staging", "production"]),
  timestamp: z.iso.datetime(),
});

export type DiscordTokenExchangeRequest = z.infer<typeof DiscordTokenExchangeRequestSchema>;
export type LocalAuthRequest = z.infer<typeof LocalAuthRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type RoomTicketRequest = z.infer<typeof RoomTicketRequestSchema>;
export type RoomTicketResponse = z.infer<typeof RoomTicketResponseSchema>;
