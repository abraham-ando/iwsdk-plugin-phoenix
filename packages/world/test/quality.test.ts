import { describe, it, expect } from 'vitest';
import { detectQuality, WORLD_PACKAGE_NAME } from '../src/core/quality';

describe('detectQuality', () => {
  it('picks low on standalone Quest headsets', () => {
    expect(detectQuality({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/34.0' })).toBe('low');
    expect(detectQuality({ userAgent: 'Quest 3 Browser' })).toBe('low');
  });

  it('picks low on weak devices regardless of user agent', () => {
    expect(detectQuality({ userAgent: 'Chrome', deviceMemory: 4 })).toBe('low');
    expect(detectQuality({ userAgent: 'Chrome', hardwareConcurrency: 4 })).toBe('low');
  });

  it('picks high on a capable desktop', () => {
    expect(detectQuality({ userAgent: 'Chrome', deviceMemory: 16, hardwareConcurrency: 12 })).toBe('high');
  });

  it('defaults to low when nothing is known (safe for VR)', () => {
    expect(detectQuality({})).toBe('low');
  });

  it('exposes the package name', () => {
    expect(WORLD_PACKAGE_NAME).toBe('@iwsdk/cardinal-world');
  });
});
