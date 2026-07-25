import { describe, expect, it } from "vitest";
import {
  issueRoomTicket,
  issueSessionToken,
  verifyRoomTicket,
  verifySessionToken,
} from "../src/worker/auth/tokens.js";

const secret = "test-signing-secret-with-more-than-thirty-two-characters";
const now = new Date("2026-07-25T00:00:00.000Z");

describe("signed tokens", () => {
  it("issues and verifies a session", async () => {
    const token = await issueSessionToken("player-1", "Player", secret, now);
    const claims = await verifySessionToken(token, secret, new Date("2026-07-25T00:01:00.000Z"));

    expect(claims.sub).toBe("player-1");
    expect(claims.displayName).toBe("Player");
  });

  it("limits a room ticket to one room", async () => {
    const sessionToken = await issueSessionToken("player-1", "Player", secret, now);
    const session = await verifySessionToken(
      sessionToken,
      secret,
      new Date("2026-07-25T00:00:10.000Z"),
    );
    const ticket = await issueRoomTicket(
      session,
      "room-1",
      secret,
      new Date("2026-07-25T00:00:10.000Z"),
    );
    const claims = await verifyRoomTicket(
      ticket.token,
      secret,
      new Date("2026-07-25T00:00:20.000Z"),
    );

    expect(claims.roomId).toBe("room-1");
  });

  it("rejects an expired session", async () => {
    const token = await issueSessionToken("player-1", "Player", secret, now);

    await expect(
      verifySessionToken(token, secret, new Date("2026-07-25T02:00:00.000Z")),
    ).rejects.toThrow("token_expired");
  });
});
