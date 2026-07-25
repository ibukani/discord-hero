import { describe, expect, it } from "vitest";
import { ClientMessageSchema, PROTOCOL_VERSION, RoomIdSchema } from "../src/index.js";

describe("protocol schemas", () => {
  it("accepts a valid skill command", () => {
    const parsed = ClientMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      type: "cast_skill",
      actionId: "action-1",
      skillId: "mage.arc_burst",
    });

    expect(parsed.type).toBe("cast_skill");
  });

  it("rejects unsupported protocol versions", () => {
    const result = ClientMessageSchema.safeParse({
      protocolVersion: 999,
      type: "start_match",
      actionId: "action-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects path-like room identifiers", () => {
    expect(RoomIdSchema.safeParse("../production").success).toBe(false);
  });
});
