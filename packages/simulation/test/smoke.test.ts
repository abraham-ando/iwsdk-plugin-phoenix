import { describe, it, expect } from 'vitest';
import { ENGINE_NAME } from '../src/index';

describe('package smoke', () => {
  it('exposes the engine name', () => {
    expect(ENGINE_NAME).toBe('@iwsdk/cardinal-simulation');
  });
});
