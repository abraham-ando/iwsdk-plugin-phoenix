import type { CompiledCharacter } from '@iwsdk/cardinal-character';

/**
 * Découpé sur la ligne de coût de la spec : ce qui recompile d'un côté, ce qui
 * est continu de l'autre.
 */
export interface CharacterApplicator {
  /** Pose de repos et ancrage. À l'instanciation, jamais par frame. */
  applyRestPose(compiled: CompiledCharacter): void;
  applyMorphs(morphs: Readonly<Record<string, number>>): void;
  applySurface(surface: Readonly<Record<string, number>>): void;
  dispose(): void;
}
