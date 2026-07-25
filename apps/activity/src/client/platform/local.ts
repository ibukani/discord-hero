import {
  AuthResponseSchema,
  HeroClassIdSchema,
  LocalAuthRequestSchema,
  RoomIdSchema,
  SafeIdSchema,
} from "@discord-hero/protocol";
import { postJson } from "../api/http.js";
import type { PlatformBridge, PlatformSession } from "./types.js";

export class LocalPlatformBridge implements PlatformBridge {
  public async initialize(): Promise<PlatformSession> {
    const query = new URLSearchParams(window.location.search);
    const roomId = RoomIdSchema.parse(
      query.get("room") ?? import.meta.env.VITE_LOCAL_ROOM_ID ?? "dev-room",
    );
    const userId = SafeIdSchema.parse(
      query.get("user") ?? import.meta.env.VITE_LOCAL_USER_ID ?? "alice",
    );
    const displayName = query.get("name") ?? import.meta.env.VITE_LOCAL_DISPLAY_NAME ?? "Alice";
    const classId = HeroClassIdSchema.parse(query.get("class") ?? "guardian");
    const request = LocalAuthRequestSchema.parse({ userId, displayName, classId, roomId });
    const auth = await postJson("/api/auth/local", request, AuthResponseSchema);

    return {
      mode: "local",
      roomId,
      user: auth.user,
      sessionToken: auth.sessionToken,
      initialClassId: classId,
    };
  }

  public invite(): Promise<void> {
    window.alert("ローカルモードでは同じroomパラメーターのURLを共有してください。");
    return Promise.resolve();
  }

  public dispose(): void {
    return;
  }
}
