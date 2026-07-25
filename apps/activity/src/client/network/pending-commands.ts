import type { ClientMessage } from "@discord-hero/protocol";

export type PendingCommand = Exclude<
  ClientMessage,
  { readonly type: "hello" } | { readonly type: "ping" } | { readonly type: "sync_request" }
>;

export class PendingCommandBuffer {
  private readonly commands = new Map<string, PendingCommand>();

  public constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Pending command capacity must be a positive integer");
    }
  }

  public add(command: PendingCommand): boolean {
    if (!this.commands.has(command.actionId) && this.commands.size >= this.capacity) {
      return false;
    }
    this.commands.set(command.actionId, command);
    return true;
  }

  public settle(actionId: string): void {
    this.commands.delete(actionId);
  }

  public replay(): readonly PendingCommand[] {
    return [...this.commands.values()];
  }

  public clear(): void {
    this.commands.clear();
  }
}
