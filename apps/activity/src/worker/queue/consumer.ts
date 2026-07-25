import { MatchFinishedEventSchema } from "@discord-hero/protocol";
import type { RuntimeEnv } from "../env.js";
import { createLogger, normalizeError } from "../observability/logger.js";
import { persistMatchResult } from "../persistence/match-result-repository.js";

export async function consumeMatchResults(batch: MessageBatch, env: RuntimeEnv): Promise<void> {
  const logger = createLogger(env.APP_ENV);

  for (const message of batch.messages) {
    const parsed = MatchFinishedEventSchema.safeParse(message.body);
    if (!parsed.success) {
      logger.error({
        event: "queue_message_rejected",
        errorCode: "invalid_match_result_event",
      });
      message.ack();
      continue;
    }

    try {
      const result = await persistMatchResult(env.DB, parsed.data);
      logger.info({
        event: "match_result_persisted",
        matchId: parsed.data.matchId,
        details: { result },
      });
      message.ack();
    } catch (error: unknown) {
      const normalized = normalizeError(error);
      logger.error({
        event: "match_result_persist_failed",
        matchId: parsed.data.matchId,
        errorCode: normalized.name,
        details: { message: normalized.message },
      });
      message.retry();
    }
  }
}
