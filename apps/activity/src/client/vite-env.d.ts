/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISCORD_CLIENT_ID?: string;
  readonly VITE_PLATFORM_MODE?: "auto" | "local" | "discord";
  readonly VITE_LOCAL_ROOM_ID?: string;
  readonly VITE_LOCAL_USER_ID?: string;
  readonly VITE_LOCAL_DISPLAY_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
