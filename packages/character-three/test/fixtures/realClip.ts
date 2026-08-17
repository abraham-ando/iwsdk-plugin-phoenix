import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimationClip } from '@iwsdk/core';

const DIR = join(__dirname, '../../../../apps/demo/public/characters');

/** Vrai si les clips récupérés par `pnpm clips` sont présents. */
export function clipsAvailable(): boolean {
  return existsSync(join(DIR, 'walk-masculine.glb'));
}

/**
 * Message de saut BRUYANT. Un test qui se saute en silence ne prouve rien —
 * ce dépôt en a déjà retiré une douzaine.
 */
export const SKIP_REASON =
  'clips RPM absents — lancer `pnpm clips` (ils ne sont pas commités, ' +
  'leur licence interdit la redistribution)';

/** Charge le premier clip d'un GLB récupéré. */
export async function loadRealClip(fileName: string): Promise<AnimationClip> {
  const buf = readFileSync(join(DIR, fileName));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<{ animations: AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(ab as ArrayBuffer, '', res as never, rej),
  );
  const clip = gltf.animations[0];
  if (clip === undefined) throw new Error(`${fileName} ne contient aucun clip`);
  return clip;
}

/** Amplitude maximale sur les trois axes d'une piste de position. */
export function amplitudeXYZ(values: ArrayLike<number>): [number, number, number] {
  const span: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < values.length; i += 3) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    span[axis] = max - min;
  }
  return span;
}
