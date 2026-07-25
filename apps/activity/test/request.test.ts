import { describe, expect, it } from "vitest";
import {
  rateLimitKey,
  requestId,
  requestRouteLabel,
  requiresEntryRateLimit,
} from "../src/worker/http/request.js";

describe("request metadata", () => {
  it("redacts room identifiers from route labels", () => {
    const request = new Request("https://activity.test/api/rooms/private-room-identifier/socket");

    expect(requestRouteLabel(request)).toBe("/api/rooms/:roomId/socket");
    expect(requestRouteLabel(request)).not.toContain("private-room-identifier");
  });

  it("uses a valid edge request identifier", () => {
    const request = new Request("https://activity.test/api/health", {
      headers: { "cf-ray": "abc123-NRT" },
    });

    expect(requestId(request)).toBe("abc123-NRT");
  });

  it("replaces untrusted request identifiers", () => {
    const request = new Request("https://activity.test/api/health", {
      headers: { "cf-ray": "invalid request identifier" },
    });

    expect(requestId(request)).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("builds entry rate-limit keys without room IDs or tokens", () => {
    const request = new Request("https://activity.test/api/rooms/private-room/socket", {
      headers: {
        authorization: "Bearer private-token",
        "cf-connecting-ip": "2001:db8::1",
      },
    });

    expect(requiresEntryRateLimit(request)).toBe(true);
    expect(rateLimitKey(request)).toBe("/api/rooms/:roomId/socket:2001:db8::1");
    expect(rateLimitKey(request)).not.toContain("private-room");
    expect(rateLimitKey(request)).not.toContain("private-token");
  });
});
