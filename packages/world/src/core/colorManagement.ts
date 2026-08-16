import { ACESFilmicToneMapping, SRGBColorSpace } from '@iwsdk/core';

/**
 * Colour management (spec §5) — the cheapest realism win available.
 * Without an explicit output colour space and a filmic tone curve, PBR
 * materials read as washed-out plastic no matter how good the textures are.
 */
export function applyColorManagement(renderer: unknown): boolean {
  // Returns whether it actually applied: doing nothing when no renderer is
  // present is correct (headless tests, workers), but a SILENT no-op in a
  // real session would leave the scene washed out with no clue why.
  if (renderer === null || renderer === undefined) return false;
  const target = renderer as { outputColorSpace?: unknown; toneMapping?: unknown };
  target.outputColorSpace = SRGBColorSpace;
  target.toneMapping = ACESFilmicToneMapping;
  return true;
}
