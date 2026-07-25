import { actionId } from "@discord-hero/game-core";
import { PROTOCOL_VERSION } from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";
import { FakeClock, MatchHarness, replayOperations, validClientMessage } from "../src/index.js";

const PLAYERS = [
  { id: "guardian-player", name: "Guardian", classId: "guardian" },
  { id: "ranger-player", name: "Ranger", classId: "ranger" },
  { id: "mage-player", name: "Mage", classId: "mage" },
  { id: "support-player", name: "Support", classId: "support" },
] as const;

describe("AI coding test harness", () => {
  it("replays an identical deterministic match", () => {
    const harness = createStartedMatch();
    runCombatToCompletion(harness);

    const replayed = replayOperations(harness.operations, {
      matchId: "test-match",
      seed: "test-seed",
    });

    expect(replayed).toEqual(harness.state);
    expect(harness.state.status).toBe("victory");
  });

  it("makes duplicate commands idempotent", () => {
    const harness = new MatchHarness();
    const duplicateActionId = actionId("duplicate-join");

    const first = harness.join("guardian-player", "Guardian", "guardian", duplicateActionId);
    const second = harness.join("guardian-player", "Guardian", "guardian", duplicateActionId);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.events).toEqual([]);
    expect(Object.keys(harness.state.players)).toHaveLength(1);
  });

  it("provides deterministic time and validated protocol fixtures", () => {
    const clock = new FakeClock(1_000);
    expect(clock.advanceBy(250)).toBe(1_250);

    const message = validClientMessage({
      type: "set_ready",
      actionId: "ready-1",
      ready: true,
    });
    expect(message.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});

function createStartedMatch(): MatchHarness {
  const harness = new MatchHarness();
  for (const player of PLAYERS) {
    expect(harness.join(player.id, player.name, player.classId).accepted).toBe(true);
    expect(harness.setReady(player.id).accepted).toBe(true);
  }
  expect(harness.start(PLAYERS[0].id).accepted).toBe(true);
  return harness;
}

function runCombatToCompletion(harness: MatchHarness): void {
  for (let stepIndex = 0; stepIndex < 5_000; stepIndex += 1) {
    if (harness.state.status === "victory" || harness.state.status === "defeat") {
      break;
    }

    for (const player of PLAYERS) {
      const state = harness.player(player.id);
      const offeredUpgrade = state.pendingUpgradeChoices[0];
      if (offeredUpgrade !== undefined) {
        expect(harness.selectUpgrade(player.id, offeredUpgrade).accepted).toBe(true);
      }
    }

    harness.step(100);
  }

  expect(harness.state.status).toBe("victory");
  for (const player of PLAYERS) {
    const state = harness.player(player.id);
    expect(state.stats.damageDealt + state.stats.healingDone).toBeGreaterThanOrEqual(0);
  }
}
