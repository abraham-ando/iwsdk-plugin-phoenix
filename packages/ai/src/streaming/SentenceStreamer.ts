export type SentenceCallback = (sentence: string, isFinal: boolean) => void;

/**
 * Incremental sentence streamer for low-latency (<150ms) token-to-speech pipelining.
 */
export class SentenceStreamer {
  private buffer = '';
  private sentenceEndRegex = /([.!?;\n])\s+/;

  constructor(private readonly onSentence: SentenceCallback) {}

  /**
   * Push incoming token chunk from LLM generator.
   */
  public push(token: string): void {
    this.buffer += token;

    let match: RegExpMatchArray | null;
    while ((match = this.buffer.match(this.sentenceEndRegex)) !== null && match.index !== undefined) {
      const splitIdx = match.index + match[1]!.length;
      const sentence = this.buffer.substring(0, splitIdx).trim();
      this.buffer = this.buffer.substring(splitIdx).trimStart();

      if (sentence.length > 0) {
        this.onSentence(sentence, false);
      }
    }
  }

  /**
   * Flush any remaining text at the end of generation.
   */
  public flush(): void {
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      this.onSentence(remaining, true);
    }
    this.buffer = '';
  }

  /**
   * Reset internal buffer.
   */
  public reset(): void {
    this.buffer = '';
  }
}
