import type { Env } from "../src/worker/env.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {
    readonly TEST_MIGRATIONS: readonly D1Migration[];
  }
}
