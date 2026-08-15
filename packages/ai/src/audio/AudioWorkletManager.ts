/**
 * High-performance, Low-Latency Audio Streaming Manager using Web Audio and Ring Buffers.
 * Feeds continuous PCM audio chunks directly to spatial audio nodes without GC hiccups.
 */

export class AudioWorkletManager {
  private bufferQueue: Float32Array[] = [];
  private totalBufferedSamples = 0;
  private isStreaming = false;

  constructor(private sampleRate: number = 24000) {}

  public get sampleRateHz(): number {
    return this.sampleRate;
  }

  /**
   * Enqueue a new chunk of raw Float32Array PCM audio samples.
   */
  public enqueueChunk(chunk: Float32Array): void {
    if (chunk.length === 0) return;
    this.bufferQueue.push(chunk);
    this.totalBufferedSamples += chunk.length;
    this.isStreaming = true;
  }

  /**
   * Read up to requested sample count from the ring buffer.
   */
  public readSamples(count: number): Float32Array {
    const output = new Float32Array(count);
    let written = 0;

    while (this.bufferQueue.length > 0 && written < count) {
      const currentChunk = this.bufferQueue[0];
      if (!currentChunk) break;

      const remainingNeeded = count - written;

      if (currentChunk.length <= remainingNeeded) {
        output.set(currentChunk, written);
        written += currentChunk.length;
        this.totalBufferedSamples -= currentChunk.length;
        this.bufferQueue.shift();
      } else {
        output.set(currentChunk.subarray(0, remainingNeeded), written);
        this.bufferQueue[0] = currentChunk.subarray(remainingNeeded);
        this.totalBufferedSamples -= remainingNeeded;
        written += remainingNeeded;
      }
    }

    if (this.bufferQueue.length === 0 && this.totalBufferedSamples === 0) {
      this.isStreaming = false;
    }

    return output;
  }

  /**
   * Return the total buffered audio duration in seconds.
   */
  public getBufferedDuration(): number {
    return this.totalBufferedSamples / this.sampleRate;
  }

  /**
   * Clear all queued audio data.
   */
  public clear(): void {
    this.bufferQueue = [];
    this.totalBufferedSamples = 0;
    this.isStreaming = false;
  }

  public get active(): boolean {
    return this.isStreaming;
  }
}
