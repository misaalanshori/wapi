export interface CompactionCoordinatorOptions {
  softLimitTokens: number;
  idleMinutes: number;
  targetTokens: number;
  headRatio: number;
  tailRatio: number;
  onCompact: (sessionId: string, customInstructions: string, keepRecentTokens: number) => Promise<void>;
}

export class CompactionCoordinator {
  private readonly options: CompactionCoordinatorOptions;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly sessionTokens = new Map<string, number>();

  constructor(options: CompactionCoordinatorOptions) {
    this.options = options;
  }

  hasActiveTimer(sessionId: string): boolean {
    return this.timers.has(sessionId);
  }

  cancelTimer(sessionId: string): void {
    const existing = this.timers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(sessionId);
    }
  }

  recordTurnTokens(sessionId: string, tokens: number): void {
    this.sessionTokens.set(sessionId, tokens);
    this.cancelTimer(sessionId);

    if (tokens >= this.options.softLimitTokens) {
      const ms = Math.max(1000, this.options.idleMinutes * 60 * 1000);
      const timeout = setTimeout(async () => {
        this.timers.delete(sessionId);
        await this.triggerCompaction(sessionId);
      }, ms);
      this.timers.set(sessionId, timeout);
    }
  }

  buildSandwichParameters(): { instructions: string; keepRecentTokens: number } {
    const totalRatio = Math.max(1, this.options.headRatio + this.options.tailRatio);
    const tailBudget = Math.round(
      this.options.targetTokens * (this.options.tailRatio / totalRatio)
    );

    const instructions =
      `Intelligent compaction sandwich (target: ~${this.options.targetTokens} tokens):\n` +
      `- Carefully preserve the initial conversation setup, primary user instructions, preferences, and project goals from the earliest messages in a dedicated '# Initial Context & Goals' section.\n` +
      `- Summarize the intermediate discussion, debugging, and tool outputs concisely in a '# Intermediate Summary' section.\n` +
      `- Recent conversational context (~${tailBudget} tokens) is retained verbatim.`;

    return {
      instructions,
      keepRecentTokens: tailBudget,
    };
  }

  async triggerCompaction(sessionId: string): Promise<void> {
    const params = this.buildSandwichParameters();
    try {
      await this.options.onCompact(sessionId, params.instructions, params.keepRecentTokens);
    } catch {
      // non-fatal to coordinator
    }
  }

  dispose(): void {
    for (const timeout of this.timers.values()) {
      clearTimeout(timeout);
    }
    this.timers.clear();
    this.sessionTokens.clear();
  }
}
