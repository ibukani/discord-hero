import { exports } from "cloudflare:workers";
import { AuthResponseSchema, RoomTicketResponseSchema } from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";

describe("room-scoped authentication", () => {
  it("allows tickets only for the room bound into the session", async () => {
    const authResponse = await exports.default.fetch(
      new Request("http://localhost/api/auth/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "room-scope-player",
          displayName: "Room Scope Player",
          classId: "guardian",
          roomId: "bound-room",
        }),
      }),
    );
    expect(authResponse.status).toBe(200);
    const auth = AuthResponseSchema.parse(await authResponse.json());

    const forbiddenResponse = await requestTicket(auth.sessionToken, "different-room");
    expect(forbiddenResponse.status).toBe(403);
    await forbiddenResponse.text();

    const allowedResponse = await requestTicket(auth.sessionToken, "bound-room");
    expect(allowedResponse.status).toBe(200);
    expect(
      RoomTicketResponseSchema.parse(await allowedResponse.json()).ticket.length,
    ).toBeGreaterThan(0);
  });
});

function requestTicket(sessionToken: string, roomId: string): Promise<Response> {
  return exports.default.fetch(
    new Request("http://localhost/api/rooms/ticket", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ roomId }),
    }),
  );
}
