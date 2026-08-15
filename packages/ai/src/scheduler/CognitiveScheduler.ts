export interface ScheduledInferenceTask<T = string> {
  id: string;
  npcId: number;
  distance: number;
  gazeAlignment: number; // [-1.0, 1.0] (1.0 = looking directly at NPC)
  timestamp: number;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

export interface CognitiveSchedulerOptions {
  /** Maximum number of concurrent GPU inference tasks (default: 1 for mobile XR) */
  maxConcurrent?: number;
  /** Minimum delay in ms between consecutive inference launches */
  dispatchThrottleMs?: number;
}

/**
 * Prioritized inference scheduler for Edge AI workloads in WebXR.
 * Ensures the mobile GPU is never overloaded by multiple simultaneous LLM kernels.
 */
export class CognitiveScheduler {
  private queue: ScheduledInferenceTask<any>[] = [];
  private activeCount = 0;
  private maxConcurrent: number;
  private dispatchThrottleMs: number;
  private lastDispatchTime = 0;

  constructor(options: CognitiveSchedulerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.dispatchThrottleMs = options.dispatchThrottleMs ?? 50;
  }

  /**
   * Schedule an inference task with spatial and gaze priority.
   */
  public enqueue<T>(
    npcId: number,
    taskFn: () => Promise<T>,
    spatial: { distance?: number; gazeAlignment?: number } = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: ScheduledInferenceTask<T> = {
        id: `${npcId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        npcId,
        distance: spatial.distance ?? 2.0,
        gazeAlignment: spatial.gazeAlignment ?? 1.0,
        timestamp: performance.now(),
        execute: taskFn,
        resolve,
        reject,
      };

      this.queue.push(task);
      this.sortQueue();
      this.pump();
    });
  }

  /**
   * Sort queue by composite priority score (higher score = executed first).
   * Score = (GazeAlignment * 2) - (Distance * 0.5) + (WaitTimeSeconds * 1.5)
   */
  private sortQueue(): void {
    const now = performance.now();
    this.queue.sort((a, b) => {
      const waitA = (now - a.timestamp) / 1000;
      const waitB = (now - b.timestamp) / 1000;

      const scoreA = a.gazeAlignment * 2.0 - a.distance * 0.5 + waitA * 1.5;
      const scoreB = b.gazeAlignment * 2.0 - b.distance * 0.5 + waitB * 1.5;

      return scoreB - scoreA;
    });
  }

  /**
   * Process pending items in the queue if capacity is available.
   */
  public pump(): void {
    const now = performance.now();
    if (now - this.lastDispatchTime < this.dispatchThrottleMs) {
      return;
    }

    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.activeCount++;
      this.lastDispatchTime = performance.now();

      task
        .execute()
        .then((res) => {
          task.resolve(res);
        })
        .catch((err) => {
          task.reject(err);
        })
        .finally(() => {
          this.activeCount--;
          this.pump();
        });
    }
  }

  /** Total number of pending queued tasks */
  public get pendingCount(): number {
    return this.queue.length;
  }

  /** Total active running tasks */
  public get runningCount(): number {
    return this.activeCount;
  }

  /** Clear all pending tasks */
  public clear(): void {
    for (const task of this.queue) {
      task.reject(new Error('CognitiveScheduler queue cleared'));
    }
    this.queue = [];
  }
}
