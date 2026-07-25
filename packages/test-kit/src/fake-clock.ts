export class FakeClock {
  private currentTimeMs: number;

  public constructor(initialTimeMs = 0) {
    if (!Number.isInteger(initialTimeMs) || initialTimeMs < 0) {
      throw new Error("initialTimeMs must be a non-negative integer");
    }
    this.currentTimeMs = initialTimeMs;
  }

  public nowMs(): number {
    return this.currentTimeMs;
  }

  public advanceBy(elapsedMs: number): number {
    if (!Number.isInteger(elapsedMs) || elapsedMs <= 0) {
      throw new Error("elapsedMs must be a positive integer");
    }
    this.currentTimeMs += elapsedMs;
    return this.currentTimeMs;
  }

  public set(timeMs: number): void {
    if (!Number.isInteger(timeMs) || timeMs < this.currentTimeMs) {
      throw new Error("timeMs must be an integer not earlier than the current time");
    }
    this.currentTimeMs = timeMs;
  }
}
