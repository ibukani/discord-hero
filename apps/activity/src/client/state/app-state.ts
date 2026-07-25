import type { DomainEventDto, GameSnapshot, ServerMessage } from "@discord-hero/protocol";
import type { ConnectionStatus } from "../network/RoomSocket.js";
import type { PlatformSession } from "../platform/types.js";

export interface AppState {
  readonly connectionStatus: ConnectionStatus;
  readonly session: PlatformSession | null;
  readonly playerId: string | null;
  readonly snapshot: GameSnapshot | null;
  readonly recentEvents: readonly DomainEventDto[];
  readonly error: string | null;
}

export type AppAction =
  | { readonly type: "platform_ready"; readonly session: PlatformSession }
  | { readonly type: "connection_changed"; readonly status: ConnectionStatus }
  | { readonly type: "server_message"; readonly message: ServerMessage }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "clear_error" };

export const INITIAL_APP_STATE: AppState = {
  connectionStatus: "idle",
  session: null,
  playerId: null,
  snapshot: null,
  recentEvents: [],
  error: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "platform_ready":
      return {
        ...state,
        session: action.session,
        error: null,
      };
    case "connection_changed":
      return {
        ...state,
        connectionStatus: action.status,
      };
    case "server_message":
      return reduceServerMessage(state, action.message);
    case "error":
      return {
        ...state,
        error: action.message,
      };
    case "clear_error":
      return {
        ...state,
        error: null,
      };
  }
}

function reduceServerMessage(state: AppState, message: ServerMessage): AppState {
  switch (message.type) {
    case "welcome":
      return {
        ...state,
        playerId: message.playerId,
        snapshot: message.snapshot,
        error: null,
      };
    case "snapshot":
      return {
        ...state,
        snapshot: message.snapshot,
      };
    case "events":
      return {
        ...state,
        recentEvents: [...message.events, ...state.recentEvents].slice(0, 8),
      };
    case "command_rejected":
      return {
        ...state,
        error: `操作が拒否されました: ${message.reason}`,
      };
    case "command_ack":
      return state;
    case "error":
      return {
        ...state,
        error: message.message,
      };
    case "pong":
      return state;
  }
}
