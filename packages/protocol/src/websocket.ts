import { z } from "zod";
import {
  ActionIdSchema,
  ErrorCodeSchema,
  HeroClassIdSchema,
  PROTOCOL_VERSION,
  ProtocolVersionSchema,
  RoomIdSchema,
  SafeIdSchema,
} from "./common.js";
import { GameSnapshotSchema } from "./game-state.js";

const ClientEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  actionId: ActionIdSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientEnvelopeSchema.extend({
    type: z.literal("hello"),
    classId: HeroClassIdSchema,
    rulesetVersion: z.string().min(1).max(32),
    contentVersion: z.string().min(1).max(32),
    lastStateRevision: z.number().int().nonnegative().nullable(),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("set_ready"),
    ready: z.boolean(),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("select_class"),
    classId: HeroClassIdSchema,
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("start_match"),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("cast_skill"),
    skillId: z.string().min(1).max(96),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("select_upgrade"),
    upgradeId: z.string().min(1).max(96),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("sync_request"),
    lastStateRevision: z.number().int().nonnegative().nullable(),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("ping"),
    clientTimeMs: z.number().int().nonnegative(),
  }),
]);

const ServerEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  stateRevision: z.number().int().nonnegative(),
  serverTick: z.number().int().nonnegative(),
});

export const DomainEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_joined"), playerId: SafeIdSchema }),
  z.object({ type: z.literal("player_disconnected"), playerId: SafeIdSchema }),
  z.object({ type: z.literal("player_reconnected"), playerId: SafeIdSchema }),
  z.object({ type: z.literal("match_started") }),
  z.object({
    type: z.literal("damage"),
    sourcePlayerId: SafeIdSchema.nullable(),
    enemyId: SafeIdSchema.nullable(),
    targetPlayerId: SafeIdSchema.nullable(),
    amount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("healing"),
    sourcePlayerId: SafeIdSchema,
    amount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("enemy_defeated"), enemyId: SafeIdSchema }),
  z.object({ type: z.literal("wave_spawned"), waveIndex: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("upgrade_choices_created"),
    playerId: SafeIdSchema,
    choices: z.array(z.string().min(1).max(96)).max(3),
  }),
  z.object({
    type: z.literal("upgrade_selected"),
    playerId: SafeIdSchema,
    upgradeId: z.string().min(1).max(96),
  }),
  z.object({
    type: z.literal("match_ended"),
    result: z.object({
      outcome: z.enum(["victory", "defeat"]),
      durationMs: z.number().int().nonnegative(),
      completedAtTick: z.number().int().nonnegative(),
    }),
  }),
]);

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerEnvelopeSchema.extend({
    type: z.literal("welcome"),
    playerId: SafeIdSchema,
    roomId: RoomIdSchema,
    snapshot: GameSnapshotSchema,
  }),
  ServerEnvelopeSchema.extend({
    type: z.literal("snapshot"),
    snapshot: GameSnapshotSchema,
  }),
  ServerEnvelopeSchema.extend({
    type: z.literal("events"),
    events: z.array(DomainEventSchema),
  }),
  ServerEnvelopeSchema.extend({
    type: z.literal("command_ack"),
    actionId: ActionIdSchema,
  }),
  ServerEnvelopeSchema.extend({
    type: z.literal("command_rejected"),
    actionId: ActionIdSchema,
    reason: z.string().min(1).max(96),
  }),
  ServerEnvelopeSchema.extend({
    type: z.literal("error"),
    code: ErrorCodeSchema,
    message: z.string().min(1).max(256),
  }),
  ServerEnvelopeSchema.extend({
    type: z.literal("pong"),
    clientTimeMs: z.number().int().nonnegative(),
    serverTimeMs: z.number().int().nonnegative(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type DomainEventDto = z.infer<typeof DomainEventSchema>;

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

export function parseServerMessage(input: unknown): ServerMessage {
  return ServerMessageSchema.parse(input);
}

export function createEnvelope(): { readonly protocolVersion: typeof PROTOCOL_VERSION } {
  return { protocolVersion: PROTOCOL_VERSION };
}
