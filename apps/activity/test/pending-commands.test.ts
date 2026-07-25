import { PROTOCOL_VERSION } from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";
import {
  PendingCommandBuffer,
  type PendingCommand,
} from "../src/client/network/pending-commands.js";

describe("pending command buffer", () => {
  it("replays an unacknowledged command with the original actionId", () => {
    const buffer = new PendingCommandBuffer(2);
    const command = createCommand("action-stable");

    expect(buffer.add(command)).toBe(true);
    expect(buffer.replay()).toEqual([command]);
    expect(buffer.replay()[0]?.actionId).toBe("action-stable");
  });

  it("removes commands after an acknowledgement or rejection", () => {
    const buffer = new PendingCommandBuffer(2);
    buffer.add(createCommand("action-settled"));

    buffer.settle("action-settled");

    expect(buffer.replay()).toEqual([]);
  });

  it("rejects new commands at capacity without dropping pending work", () => {
    const buffer = new PendingCommandBuffer(1);
    const first = createCommand("action-first");

    expect(buffer.add(first)).toBe(true);
    expect(buffer.add(createCommand("action-overflow"))).toBe(false);
    expect(buffer.replay()).toEqual([first]);
  });
});

function createCommand(actionId: string): PendingCommand {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "set_ready",
    actionId,
    ready: true,
  };
}
