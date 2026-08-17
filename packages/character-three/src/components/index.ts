import { createComponent, Types } from '@iwsdk/core';

const gene = (label: string) => ({
  // `as const` : sans lui, l'inférence de retour élargit `Types.Float32` en
  // `Types` (l'union de tout l'enum), ce qui ne matche plus aucun membre du
  // schéma discriminé par `type` dans `SchemaField`.
  type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01, label,
} as const);

export const CharacterIdentity = createComponent('CharacterIdentity', {
  // `enum` veut une MAP { clé: valeur }, pas un tableau : elics valide la
  // valeur par défaut avec `Object.values(enum).includes(default)`, et le
  // type `EnumType` (`{[key: string]: string}`) n'accepte pas `string[]` — un
  // tableau n'a pas de signature d'index sur `string` (voir `length: number`).
  family: { type: Types.Enum, enum: { humanoid: 'humanoid' }, default: 'humanoid' },
  sex: { type: Types.Enum, enum: { f: 'f', m: 'm' }, default: 'f' },
  age: { type: Types.Float32, default: 25, min: 0, max: 90, step: 0.5, label: 'Âge' },
  seed: { type: Types.Int32, default: 0, help: 'Graine du tirage — rejouable' },
});

/** Modifier un champ ici RECOMPILE le squelette. */
export const CharacterStructure = createComponent('CharacterStructure', {
  stature: gene('Stature'),
  armLength: gene('Longueur de bras'),
  legLength: gene('Longueur de jambe'),
  torsoLength: gene('Longueur de tronc'),
  shoulderWidth: gene("Largeur d'épaules"),
});

/** Modifier un champ ici s'applique à la frame suivante, sans recompiler. */
export const CharacterFace = createComponent('CharacterFace', {
  jawWidth: gene('Mâchoire'),
  noseSize: gene('Nez'),
  eyeScale: gene('Yeux'),
  cheekbone: gene('Pommettes'),
  bodyMass: gene('Corpulence'),
});

export const CharacterSurface = createComponent('CharacterSurface', {
  // Types.Color est un champ VECTEUR : setValue lève dessus en elics 3.4.x,
  // il faut passer par getVectorView.
  skin: { type: Types.Color, default: [0.82, 0.7, 0.55, 1] },
  hair: { type: Types.Color, default: [0.2, 0.13, 0.09, 1] },
});

/** Singleton : une seule cible d'édition, sinon chaque panneau garde la sienne. */
export const CharacterSelection = createComponent('CharacterSelection', {
  target: { type: Types.Entity, default: null },
});
