import { describe, it, expect } from 'vitest';
import { SentenceStreamer } from '../src/streaming/SentenceStreamer';

describe('SentenceStreamer', () => {
  it('streams sentence by sentence upon terminal punctuation', () => {
    const emitted: string[] = [];
    const streamer = new SentenceStreamer((sentence) => {
      emitted.push(sentence);
    });

    streamer.push('Bonjour noble ');
    streamer.push('voyageur ! ');
    streamer.push('Que cherches-tu ');
    streamer.push('dans nos contrées ? ');

    expect(emitted).toEqual([
      'Bonjour noble voyageur !',
      'Que cherches-tu dans nos contrées ?',
    ]);
  });

  it('flushes incomplete trailing text upon completion', () => {
    const emitted: string[] = [];
    const streamer = new SentenceStreamer((sentence) => {
      emitted.push(sentence);
    });

    streamer.push('Phrase sans ponctuation finale');
    streamer.flush();

    expect(emitted).toEqual(['Phrase sans ponctuation finale']);
  });
});
