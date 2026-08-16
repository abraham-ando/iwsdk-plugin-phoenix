import { ACESFilmicToneMapping, SRGBColorSpace } from '@iwsdk/core';

/**
 * Colour management (spec §5) — the cheapest realism win available.
 * Without an explicit output colour space and a filmic tone curve, PBR
 * materials read as washed-out plastic no matter how good the textures are.
 */
export function applyColorManagement(renderer: unknown): void {
  if (renderer === null || renderer === undefined) return;
  const target = renderer as { outputColorSpace?: unknown; toneMapping?: unknown };
  target.outputColorSpace = SRGBColorSpace;
  target.toneMapping = ACESFilmicToneMapping;
}
