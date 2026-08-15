import { describe, it, expect } from 'vitest';
import { AudioWorkletManager } from '../src/audio/AudioWorkletManager';

describe('AudioWorkletManager', () => {
  it('should enqueue audio PCM chunks and report buffered duration', () => {
    const manager = new AudioWorkletManager(24000); // 24 kHz

    // 24000 samples = exactly 1.0 second of audio
    const chunk1 = new Float32Array(12000);
    const chunk2 = new Float32Array(12000);

    manager.enqueueChunk(chunk1);
    expect(manager.getBufferedDuration()).toBe(0.5);

    manager.enqueueChunk(chunk2);
    expect(manager.getBufferedDuration()).toBe(1.0);
    expect(manager.active).toBe(true);
  });

  it('should read samples continuously across chunk boundaries', () => {
    const manager = new AudioWorkletManager(24000);

    const chunk1 = new Float32Array([1.0, 2.0, 3.0]);
    const chunk2 = new Float32Array([4.0, 5.0, 6.0]);

    manager.enqueueChunk(chunk1);
    manager.enqueueChunk(chunk2);

    const read = manager.readSamples(4);
    expect(read).toHaveLength(4);
    expect(Array.from(read)).toEqual([1.0, 2.0, 3.0, 4.0]);

    const remaining = manager.readSamples(2);
    expect(Array.from(remaining)).toEqual([5.0, 6.0]);

    expect(manager.active).toBe(false);
  });

  it('should clear buffer on demand', () => {
    const manager = new AudioWorkletManager(24000);
    manager.enqueueChunk(new Float32Array(1000));
    expect(manager.getBufferedDuration()).toBeGreaterThan(0);

    manager.clear();
    expect(manager.getBufferedDuration()).toBe(0);
    expect(manager.active).toBe(false);
  });
});
