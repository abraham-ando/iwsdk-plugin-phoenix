/**
 * Calcul pur des percentiles d'un jeu d'échantillons de temps de frame, en
 * millisecondes.
 *
 * Extrait de `FrameSampler.report()` dans GpuContentionProbe.ts pour être
 * testable sans `requestAnimationFrame` ni DOM : même schéma (tri croissant,
 * `at(q) = tri[min(length-1, floor(length*q))]`), étendu à p99.
 */
export function percentiles(samplesMs: number[]): { p50: number; p95: number; p99: number } {
  if (samplesMs.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const tri = [...samplesMs].sort((a, b) => a - b);
  const at = (q: number): number => tri[Math.min(tri.length - 1, Math.floor(tri.length * q))]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}
