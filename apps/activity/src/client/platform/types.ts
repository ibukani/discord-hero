import type { HeroClassIdDto } from "@discord-hero/protocol";

export interface PlatformUser {
  readonly id: string;
  readonly displayName: string;
}

export interface PlatformSession {
  readonly mode: "local" | "discord";
  readonly roomId: string;
  readonly user: PlatformUser;
  readonly sessionToken: string;
  readonly initialClassId: HeroClassIdDto;
}

export interface PlatformBridge {
  initialize(): Promise<PlatformSession>;
  invite(): Promise<void>;
  dispose(): void;
}
