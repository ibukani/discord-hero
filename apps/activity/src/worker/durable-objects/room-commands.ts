import { actionId, playerId, type GameCommand } from "@discord-hero/game-core";
import type { ClientMessage } from "@discord-hero/protocol";
import type { ConnectionAttachment } from "./room-connections.js";

export type MutatingClientMessage = Exclude<
  ClientMessage,
  { readonly type: "ping" } | { readonly type: "sync_request" }
>;

export function toGameCommand(
  message: MutatingClientMessage,
  attachment: ConnectionAttachment,
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
        classId: message.classId,
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
    case "start_match":
      return {
        type: "start_match",
        actionId: commandActionId,
        playerId: actorId,
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
  }
}
