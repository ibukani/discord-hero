import { actionId, matchId, playerId, type GameCommand } from "@discord-hero/game-core";
import type { ClientMessage, HeroClassIdDto } from "@discord-hero/protocol";
import type { ConnectionAttachment } from "./room-connections.js";

export type MutatingClientMessage = Exclude<
  ClientMessage,
  { readonly type: "ping" } | { readonly type: "sync_request" }
>;

export function toGameCommand(
  message: MutatingClientMessage,
  attachment: ConnectionAttachment,
  persistedClassId?: HeroClassIdDto,
): GameCommand {
  const actorId = playerId(attachment.playerId);
  const commandActionId = actionId(message.actionId);

  switch (message.type) {
    case "hello":
      return {
        type: "join_player",
        actionId: commandActionId,
        playerId: actorId,
        displayName: attachment.displayName,
        classId: persistedClassId ?? message.classId,
      };
    case "set_ready":
      return {
        type: "set_ready",
        actionId: commandActionId,
        playerId: actorId,
        ready: message.ready,
      };
    case "select_class":
      return {
        type: "select_class",
        actionId: commandActionId,
        playerId: actorId,
        classId: message.classId,
      };
    case "set_automation_policy":
      return {
        type: "set_automation_policy",
        actionId: commandActionId,
        playerId: actorId,
        policy: {
          ...message.policy,
          rescue: message.policy.rescue,
        },
      };
    case "set_loadout":
      return {
        type: "set_loadout",
        actionId: commandActionId,
        playerId: actorId,
        activeSkillIds: [...message.activeSkillIds],
      };
    case "set_equipment":
      return {
        type: "set_equipment",
        actionId: commandActionId,
        playerId: actorId,
        weaponId: message.weaponId,
        armorId: message.armorId,
        accessoryId: message.accessoryId,
      };
    case "start_match":
      return {
        type: "start_match",
        actionId: commandActionId,
        playerId: actorId,
      };
    case "restart_match":
      return {
        type: "restart_match",
        actionId: commandActionId,
        playerId: actorId,
        matchId: matchId(`match-${crypto.randomUUID()}`),
        seed: `seed-${crypto.randomUUID()}`,
      };
    case "return_to_lobby":
      return {
        type: "return_to_lobby",
        actionId: commandActionId,
        playerId: actorId,
        matchId: matchId(`match-${crypto.randomUUID()}`),
        seed: `seed-${crypto.randomUUID()}`,
      };
    case "cast_skill":
      return {
        type: "cast_skill",
        actionId: commandActionId,
        playerId: actorId,
        skillId: message.skillId,
      };
    case "select_upgrade":
      return {
        type: "select_upgrade",
        actionId: commandActionId,
        playerId: actorId,
        upgradeId: message.upgradeId,
      };
    case "override_decision":
      return {
        type: "override_decision",
        actionId: commandActionId,
        playerId: actorId,
        decisionId: message.decisionId,
        choiceId: message.choiceId,
      };
    case "rescue_player":
      return {
        type: "rescue_player",
        actionId: commandActionId,
        playerId: actorId,
        targetPlayerId: playerId(message.targetPlayerId),
      };
  }
}
