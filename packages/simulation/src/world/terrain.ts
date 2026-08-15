/**
 * Analytic terrain height field (spec §4.2). Single source of truth: the VR
 * demo's ProceduralTerrain delegates here so simulation and rendering can
 * never diverge. Pure math — no three.js.
 */
export const WORLD_SIZE = 64;

export function getTerrainHeight(x: number, z: number): number {
  const distFromCenter = Math.sqrt(x * x + (z + 2.5) * (z + 2.5));

  // Central settlement flat plateau (radius 5 m is completely flat at 0.0)
  if (distFromCenter < 5.0) {
    return 0.0;
  }

  // Smooth hermite blend from flat village (0.0) to rolling hills beyond 5 m
  const t = Math.min(1.0, (distFromCenter - 5.0) / 4.0);
  const blend = t * t * (3 - 2 * t);

  const hill1 = Math.sin(x * 0.08) * Math.cos(z * 0.08) * 1.8;
  const hill2 =
    (Math.sin(x * 0.05 + 1.2) * Math.cos(z * 0.05 + 0.8) - Math.sin(1.2) * Math.cos(0.8)) * 2.5;

  const mountainRise = distFromCenter > 16 ? Math.pow((distFromCenter - 16) * 0.18, 1.8) : 0;

  const riverX = 4.0 + Math.sin(z * 0.12) * 3.5;
  const distToRiver = Math.abs(x - riverX);
  const riverCarve = distToRiver < 4.0 ? Math.cos((distToRiver / 4.0) * (Math.PI / 2)) * 1.2 : 0;

  const microDetail = Math.sin(x * 0.35) * Math.cos(z * 0.35) * 0.15;

  const rawHeight = Math.max(0, hill1 + hill2 + mountainRise - riverCarve + microDetail);
  return rawHeight * blend;
}

export function isRiverAt(x: number, z: number): boolean {
  const riverX = 4.0 + Math.sin(z * 0.12) * 3.5;
  return Math.abs(x - riverX) < 2.2;
}

export function isShoreAt(x: number, z: number): boolean {
  const riverX = 4.0 + Math.sin(z * 0.12) * 3.5;
  const d = Math.abs(x - riverX);
  return d >= 2.2 && d < 4.5;
}
