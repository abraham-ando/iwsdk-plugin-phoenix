import { describe, it, expect } from 'vitest';
import { CognitiveScheduler } from '../src/scheduler/CognitiveScheduler';

describe('CognitiveScheduler', () => {
  it('executes tasks and respects gaze/distance prioritization', async () => {
    const scheduler = new CognitiveScheduler({ maxConcurrent: 1, dispatchThrottleMs: 0 });

    const executionOrder: number[] = [];

    const p1 = scheduler.enqueue(
      1,
      async () => {
        executionOrder.push(1);
        return 'res1';
      },
      { distance: 10.0, gazeAlignment: -0.5 } // far & away from gaze
    );

    const p2 = scheduler.enqueue(
      2,
      async () => {
        executionOrder.push(2);
        return 'res2';
      },
      { distance: 1.5, gazeAlignment: 1.0 } // close & looked directly at
    );

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('res1');
    expect(r2).toBe('res2');
    expect(executionOrder).toContain(1);
    expect(executionOrder).toContain(2);
  });
});
