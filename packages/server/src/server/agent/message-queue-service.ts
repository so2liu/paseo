import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import {
  AgentMessageQueueItemSchema,
  type AgentMessageQueueItem,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import { buildAgentPrompt } from "./prompt-attachments.js";
import { sendPromptToAgent } from "./agent-prompt.js";

const QueueFileSchema = z.object({
  items: z.array(AgentMessageQueueItemSchema),
  receipts: z
    .array(
      z.object({
        agentId: z.string(),
        messageId: z.string(),
        acceptedAt: z.string(),
      }),
    )
    .optional(),
});

const MAX_MESSAGE_RECEIPTS = 20_000;

interface AgentMessageQueueReceipt {
  agentId: string;
  messageId: string;
  acceptedAt: string;
}

export type AgentMessageQueueListener = (agentId: string, items: AgentMessageQueueItem[]) => void;

export class AgentMessageQueueService {
  private readonly filePath: string;
  private readonly logger: pino.Logger;
  private readonly itemsByAgent = new Map<string, AgentMessageQueueItem[]>();
  private receipts: AgentMessageQueueReceipt[] = [];
  private readonly receiptKeys = new Set<string>();
  private readonly listeners = new Set<AgentMessageQueueListener>();
  private readonly draining = new Set<string>();
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    paseoHome: string,
    private readonly agentManager: AgentManager,
    private readonly agentStorage: AgentStorage,
    logger: pino.Logger,
  ) {
    this.filePath = path.join(paseoHome, "message-queue", "queue.json");
    this.logger = logger.child({ component: "agent-message-queue" });
    this.agentManager.subscribe(
      (event) => {
        if (event.type === "agent_state" && event.agent.lifecycle === "idle") {
          void this.drain(event.agent.id);
        }
      },
      { replayState: false },
    );
    void this.resumePersistedQueues().catch((error) => {
      this.logger.error({ err: error }, "Failed to resume persisted agent message queues");
    });
  }

  subscribe(listener: AgentMessageQueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(agentId: string): Promise<AgentMessageQueueItem[]> {
    await this.load();
    return [...(this.itemsByAgent.get(agentId) ?? [])];
  }

  async enqueue(
    input: Omit<AgentMessageQueueItem, "createdAt" | "updatedAt">,
  ): Promise<AgentMessageQueueItem[]> {
    return await this.mutate(input.agentId, (items) => {
      if (this.receiptKeys.has(this.receiptKey(input.agentId, input.id))) {
        return items;
      }
      const existing = items.find((item) => item.id === input.id);
      if (existing) {
        this.rememberReceipt(input.agentId, input.id, existing.createdAt);
        return items;
      }
      const now = new Date().toISOString();
      this.rememberReceipt(input.agentId, input.id, now);
      return [...items, { ...input, createdAt: now, updatedAt: now }];
    });
  }

  async remove(agentId: string, messageId: string): Promise<AgentMessageQueueItem[]> {
    return await this.mutate(agentId, (items) => items.filter((item) => item.id !== messageId));
  }

  async steer(agentId: string, messageId: string): Promise<AgentMessageQueueItem[]> {
    await this.load();
    const item = this.itemsByAgent.get(agentId)?.find((candidate) => candidate.id === messageId);
    if (!item) {
      throw new Error("Queued message not found");
    }
    if (this.draining.has(agentId)) {
      throw new Error("Queued message is already being dispatched");
    }
    this.draining.add(agentId);
    try {
      const prompt = buildAgentPrompt(item.text, item.images, item.attachments);
      const steered =
        (await this.agentManager.steerAgentRun(agentId, prompt)).status === "accepted";
      if (!steered) {
        // The provider may finish between the UI rendering the steer action and
        // this request reaching the daemon. Preserve the user's intent by
        // starting the same queued message as the next ordinary turn.
        await sendPromptToAgent({
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          agentId,
          prompt,
          messageId: item.id,
          logger: this.logger,
        });
      }
      return await this.remove(agentId, messageId);
    } finally {
      this.draining.delete(agentId);
    }
  }

  async drain(agentId: string): Promise<void> {
    await this.load();
    if (this.draining.has(agentId) || this.agentManager.hasInFlightRun(agentId)) {
      return;
    }
    const item = this.itemsByAgent.get(agentId)?.[0];
    if (!item) {
      return;
    }
    this.draining.add(agentId);
    try {
      const prompt = buildAgentPrompt(item.text, item.images, item.attachments);
      await sendPromptToAgent({
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        agentId,
        prompt,
        messageId: item.id,
        logger: this.logger,
      });
      await this.remove(agentId, item.id);
    } catch (error) {
      this.logger.warn(
        { err: error, agentId, messageId: item.id },
        "Failed to drain queued message",
      );
    } finally {
      this.draining.delete(agentId);
    }
  }

  private async mutate(
    agentId: string,
    update: (items: AgentMessageQueueItem[]) => AgentMessageQueueItem[],
  ): Promise<AgentMessageQueueItem[]> {
    await this.load();
    const operation = this.mutationQueue.then(() => this.applyMutation(agentId, update));
    this.mutationQueue = operation.then(() => undefined).catch(() => undefined);
    return [...(await operation)];
  }

  private async applyMutation(
    agentId: string,
    update: (items: AgentMessageQueueItem[]) => AgentMessageQueueItem[],
  ): Promise<AgentMessageQueueItem[]> {
    const result = update(this.itemsByAgent.get(agentId) ?? []);
    this.itemsByAgent.set(agentId, result);
    await this.persist();
    this.emit(agentId, result);
    return result;
  }

  private async load(): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = (async () => {
      try {
        const parsed = QueueFileSchema.parse(JSON.parse(await fs.readFile(this.filePath, "utf8")));
        for (const receipt of parsed.receipts ?? []) {
          const key = this.receiptKey(receipt.agentId, receipt.messageId);
          if (this.receiptKeys.has(key)) continue;
          this.receiptKeys.add(key);
          this.receipts.push(receipt);
        }
        for (const item of parsed.items) {
          const items = this.itemsByAgent.get(item.agentId) ?? [];
          items.push(item);
          this.itemsByAgent.set(item.agentId, items);
          this.rememberReceipt(item.agentId, item.id, item.createdAt);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.logger.error({ err: error }, "Failed to load agent message queue");
          throw error;
        }
      }
    })();
    await this.loadPromise;
  }

  private async resumePersistedQueues(): Promise<void> {
    await this.load();
    await Promise.all(Array.from(this.itemsByAgent.keys(), (agentId) => this.drain(agentId)));
  }

  private async persist(): Promise<void> {
    const items = Array.from(this.itemsByAgent.values()).flat();
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await writeJsonFileAtomic(this.filePath, { items, receipts: this.receipts });
  }

  private receiptKey(agentId: string, messageId: string): string {
    return `${agentId}\0${messageId}`;
  }

  private rememberReceipt(agentId: string, messageId: string, acceptedAt: string): void {
    const key = this.receiptKey(agentId, messageId);
    if (this.receiptKeys.has(key)) return;
    this.receiptKeys.add(key);
    this.receipts.push({ agentId, messageId, acceptedAt });
    this.pruneReceipts();
  }

  private pruneReceipts(): void {
    if (this.receipts.length <= MAX_MESSAGE_RECEIPTS) return;
    const queuedKeys = new Set(
      Array.from(this.itemsByAgent.entries()).flatMap(([agentId, items]) =>
        items.map((item) => this.receiptKey(agentId, item.id)),
      ),
    );
    const kept: AgentMessageQueueReceipt[] = [];
    let retainedCompleted = 0;
    for (let index = this.receipts.length - 1; index >= 0; index -= 1) {
      const receipt = this.receipts[index];
      if (!receipt) continue;
      const isQueued = queuedKeys.has(this.receiptKey(receipt.agentId, receipt.messageId));
      if (isQueued || retainedCompleted < MAX_MESSAGE_RECEIPTS) {
        kept.push(receipt);
        if (!isQueued) retainedCompleted += 1;
      }
    }
    this.receipts = kept.toReversed();
    this.receiptKeys.clear();
    for (const receipt of this.receipts) {
      this.receiptKeys.add(this.receiptKey(receipt.agentId, receipt.messageId));
    }
  }

  private emit(agentId: string, items: AgentMessageQueueItem[]): void {
    for (const listener of this.listeners) {
      listener(agentId, [...items]);
    }
  }
}
