export class EchoTracker {
  private readonly ids = new Set<string>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 120_000) {
    this.ttlMs = ttlMs;
  }

  track(id: string): void {
    if (!id) return;
    this.ids.add(id);
    setTimeout(() => {
      this.ids.delete(id);
    }, this.ttlMs).unref?.();
  }

  isSelfEcho(id: string | null | undefined): boolean {
    if (!id) return false;
    return this.ids.has(id);
  }

  clear(): void {
    this.ids.clear();
  }
}
