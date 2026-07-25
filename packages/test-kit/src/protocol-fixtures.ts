import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@discord-hero/protocol";

type WithoutProtocolVersion<Message> = Message extends unknown
  ? Omit<Message, "protocolVersion">
  : never;

export function validClientMessage(input: WithoutProtocolVersion<ClientMessage>): ClientMessage {
  return ClientMessageSchema.parse({
    ...input,
    protocolVersion: PROTOCOL_VERSION,
  });
}

export function validServerMessage(input: ServerMessage): ServerMessage {
  return ServerMessageSchema.parse(input);
}
