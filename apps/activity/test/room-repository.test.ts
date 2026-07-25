import { CURRENT_CONTENT } from "@discord-hero/content";
import type { MatchFinishedEvent } from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";
import {
  COMPLETION_OUTBOX_STORAGE_KEY,
  RESULT_QUEUED_PREFIX,
  ROOM_LIFECYCLE_STORAGE_KEY,
} from "../src/worker/durable-objects/completion-outbox.js";
import {
  RoomRepository,
  type MatchResultQueue,
  type RoomStorage,
} from "../src/worker/durable-objects/room-repository.js";
import type { Logger } from "../src/worker/observability/logger.js";

describe("room completion repository", () => {
  it("retains an outbox and schedules an alarm after a Queue failure", async () => {
    const storage = new MemoryRoomStorage();
    const queue = new ControlledQueue(true);
    const repository = new RoomRepository(storage, queue, NULL_LOGGER);
    const event = createFinishedEvent();
    await storage.put(COMPLETION_OUTBOX_STORAGE_KEY, event);
    const before = Date.now();

    expect(await repository.handleAlarm("room-retry")).toBe("retained");

    expect(await storage.get(COMPLETION_OUTBOX_STORAGE_KEY)).toEqual(event);
    expect(storage.scheduledAlarmMs).toBeGreaterThanOrEqual(before + 60_000);
    expect(await storage.get(`${RESULT_QUEUED_PREFIX}${event.matchId}`)).toBeUndefined();
  });

  it("removes a delivered outbox, marks it, and schedules cleanup", async () => {
    const storage = new MemoryRoomStorage();
    const queue = new ControlledQueue(false);
    const repository = new RoomRepository(storage, queue, NULL_LOGGER);
    const event = createFinishedEvent();
    await storage.put(COMPLETION_OUTBOX_STORAGE_KEY, event);

    expect(await repository.handleAlarm("room-delivery")).toBe("retained");

    expect(queue.delivered).toEqual([event]);
    expect(await storage.get(COMPLETION_OUTBOX_STORAGE_KEY)).toBeUndefined();
    expect(await storage.get(`${RESULT_QUEUED_PREFIX}${event.matchId}`)).toBe(true);
    expect(await storage.get(ROOM_LIFECYCLE_STORAGE_KEY)).toBeDefined();
    expect(storage.scheduledAlarmMs).toBeGreaterThan(Date.now());
  });
});

class MemoryRoomStorage implements RoomStorage {
  private readonly values = new Map<string, unknown>();
  public scheduledAlarmMs: number | null = null;

  public get(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key));
  }

  public put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  public setAlarm(scheduledTime: number | Date): Promise<void> {
    this.scheduledAlarmMs = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
    return Promise.resolve();
  }

  public deleteAlarm(): Promise<void> {
    this.scheduledAlarmMs = null;
    return Promise.resolve();
  }

  public deleteAll(): Promise<void> {
    this.values.clear();
    return Promise.resolve();
  }
}

class ControlledQueue implements MatchResultQueue {
  public readonly delivered: MatchFinishedEvent[] = [];

  public constructor(private readonly shouldFail: boolean) {}

  public send(message: MatchFinishedEvent): Promise<unknown> {
    if (this.shouldFail) {
      return Promise.reject(new Error("queue unavailable"));
    }
    this.delivered.push(message);
    return Promise.resolve({ outcome: "success" });
  }
}

const NULL_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function createFinishedEvent(): MatchFinishedEvent {
  return {
    eventId: "match-repository:finished",
    matchId: "match-repository",
    rulesetVersion: CURRENT_CONTENT.rulesetVersion,
    contentVersion: CURRENT_CONTENT.version,
    seed: "repository-seed",
    startedAt: "2026-07-25T00:00:00.000Z",
    endedAt: "2026-07-25T00:01:00.000Z",
    result: {
      outcome: "victory",
      durationMs: 60_000,
      completedAtTick: 600,
      rewards: {},
    },
    players: [],
  };
}
