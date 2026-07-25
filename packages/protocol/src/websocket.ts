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
import {
  ActiveDecisionSchema,
  AccountProgressSchema,
  AutomationPolicySchema,
  DEFAULT_ACCOUNT_PROGRESS,
  DecisionSummarySchema,
  GameSnapshotSchema,
  MatchResultSchema,
  RetreatPolicySchema,
} from "./game-state.js";

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
    type: z.literal("set_automation_policy"),
    policy: AutomationPolicySchema,
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("set_loadout"),
    activeSkillIds: z.array(z.string().min(1).max(96)).min(1).max(2),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("set_equipment"),
    weaponId: SafeIdSchema.nullable(),
    armorId: SafeIdSchema.nullable(),
    accessoryId: SafeIdSchema.nullable(),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("start_match"),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("restart_match"),
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("return_to_lobby"),
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
    type: z.literal("override_decision"),
    decisionId: SafeIdSchema,
    choiceId: SafeIdSchema,
  }),
  ClientEnvelopeSchema.extend({
    type: z.literal("rescue_player"),
    targetPlayerId: SafeIdSchema,
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
    type: z.literal("decision_opened"),
    decision: ActiveDecisionSchema,
  }),
  z.object({
    type: z.literal("decision_overridden"),
    playerId: SafeIdSchema,
    decisionId: SafeIdSchema,
    choiceId: SafeIdSchema,
  }),
  z.object({
    type: z.literal("decision_resolved"),
    decision: DecisionSummarySchema,
  }),
  z.object({
    type: z.literal("retreat_decided"),
    policy: RetreatPolicySchema,
    reason: z.string().min(1).max(96),
    averageHpPercent: z.number().int().nonnegative().max(100),
  }),
  z.object({
    type: z.literal("player_downed"),
    playerId: SafeIdSchema,
    rescueDeadlineMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("rescue_started"),
    rescuerId: SafeIdSchema,
    targetId: SafeIdSchema,
  }),
  z.object({
    type: z.literal("player_rescued"),
    rescuerId: SafeIdSchema,
    targetId: SafeIdSchema,
    hp: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("player_eliminated"),
    playerId: SafeIdSchema,
  }),
  z.object({
    type: z.literal("equipment_changed"),
    playerId: SafeIdSchema,
    weaponId: SafeIdSchema.nullable(),
    armorId: SafeIdSchema.nullable(),
    accessoryId: SafeIdSchema.nullable(),
    synergyIds: z.array(SafeIdSchema).max(16),
  }),
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
    type: z.literal("skill_used"),
    playerId: SafeIdSchema,
    skillId: z.string().min(1).max(96),
  }),
  z.object({
    type: z.literal("match_ended"),
    result: MatchResultSchema,
  }),
]);

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerEnvelopeSchema.extend({
    type: z.literal("welcome"),
    playerId: SafeIdSchema,
    roomId: RoomIdSchema,
    accountProgress: AccountProgressSchema.default(DEFAULT_ACCOUNT_PROGRESS),
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
