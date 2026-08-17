import { describe, it, expect } from 'vitest';
import { ENGINE_NAME } from '../src/index';

describe('paquet', () => {
  it('expose son nom', () => {
    expect(ENGINE_NAME).toBe('@iwsdk/cardinal-character');
  });
});
