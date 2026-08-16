/**
 * Runtime quality tier (spec §2, §5). Every visual effect exists in a
 * mobile-safe and a desktop-rich variant; this is what picks between them.
 * Pure and environment-injected so it is testable without globals.
 */
export type QualityTier = 'low' | 'high';

export const WORLD_PACKAGE_NAME = '@iwsdk/cardinal-world';

export interface QualityEnv {
  userAgent?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

const STANDALONE_VR = /OculusBrowser|Quest|Pico|Wolvic/i;

export function detectQuality(env: QualityEnv = readQualityEnv()): QualityTier {
  if (env.userAgent !== undefined && STANDALONE_VR.test(env.userAgent)) return 'low';
  const memory = env.deviceMemory;
  const cores = env.hardwareConcurrency;
  // Unknown hardware defaults to low: shipping a too-heavy scene to a headset
  // is far worse than shipping a too-light one to a desktop.
  if (memory === undefined && cores === undefined) return 'low';
  if (memory !== undefined && memory <= 4) return 'low';
  if (cores !== undefined && cores <= 4) return 'low';
  return 'high';
}

export function readQualityEnv(): QualityEnv {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  };
}
