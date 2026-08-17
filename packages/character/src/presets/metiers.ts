import type { FamilyDescriptor } from '../family/types';
import type { Genome } from '../genome/types';
import type { Preset } from './types';

const p = (
  id: string,
  genes: Record<string, number>,
  ageRange: readonly [number, number],
  note: string,
): Preset => ({ id, version: 1, family: 'humanoid', genes, ageRange, note });

/**
 * Les huit métiers du village. Ce ne sont pas des costumes : chaque archétype
 * décrit ce que le métier fait au corps sur vingt ans de pratique.
 */
export const METIERS: Readonly<Record<string, Preset>> = {
  charbonnier: p('charbonnier', { shoulderWidth: 0.7, bodyMass: 0.62, stature: 0.45, armLength: 0.55 },
    [22, 60], 'Trapu, épaules solides — porter et empiler toute la journée.'),

  ferronnier: p('ferronnier', { shoulderWidth: 0.88, bodyMass: 0.75, stature: 0.55, armLength: 0.62, jawWidth: 0.7 },
    [28, 55], 'Charpente lourde, avant-bras longs — le marteau plutôt que la taille.'),

  chasseur: p('chasseur', { shoulderWidth: 0.6, bodyMass: 0.35, stature: 0.68, legLength: 0.78, armLength: 0.6 },
    [20, 50], 'Sec et long de jambe — la poursuite avant la force.'),

  pecheur: p('pecheur', { shoulderWidth: 0.72, bodyMass: 0.5, stature: 0.5, armLength: 0.7, torsoLength: 0.6 },
    [24, 62], 'Tronc développé, bras longs — la rame et le filet.'),

  chercheur: p('chercheur', { shoulderWidth: 0.38, bodyMass: 0.3, stature: 0.55, armLength: 0.45, eyeScale: 0.65 },
    [30, 70], 'Peu de masse, regard marqué — une vie assise près du feu.'),

  inventeur: p('inventeur', { shoulderWidth: 0.45, bodyMass: 0.4, stature: 0.52, armLength: 0.52, cheekbone: 0.6 },
    [26, 60], 'Ordinaire de corps, mains constamment occupées.'),

  enseignant: p('enseignant', { shoulderWidth: 0.5, bodyMass: 0.45, stature: 0.58, torsoLength: 0.55 },
    [28, 68], 'Médian en tout — le corps ne dit rien, la posture dit tout.'),

  commercant: p('commercant', { shoulderWidth: 0.55, bodyMass: 0.58, stature: 0.5, legLength: 0.6 },
    [25, 65], 'Bien nourri et bon marcheur — la route entre les villages.'),
};

export function genomeFromPreset(family: FamilyDescriptor, preset: Preset): Genome {
  if (preset.family !== family.id) {
    throw new Error(
      `genomeFromPreset: preset "${preset.id}" de famille "${preset.family}" pour "${family.id}"`,
    );
  }
  const genes: Record<string, number> = {};
  for (const key of Object.keys(family.genes).sort()) {
    genes[key] = preset.genes[key] ?? 0.5;
  }
  return { family: family.id, genes };
}
