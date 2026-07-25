export type AppEnvironment = "local" | "staging" | "production";

export interface Env {
  readonly APP_ENV: AppEnvironment;
  readonly ALLOW_LOCAL_AUTH: string;
  readonly DISCORD_CLIENT_ID: string;
  readonly DISCORD_CLIENT_SECRET: string;
  readonly SESSION_SIGNING_SECRET: string;
  readonly ASSETS: Fetcher;
  readonly DB: D1Database;
  readonly GAME_ROOMS: DurableObjectNamespace;
  readonly MATCH_RESULTS_QUEUE: Queue;
}
