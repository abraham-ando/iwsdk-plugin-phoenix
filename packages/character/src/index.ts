export const ENGINE_NAME = '@iwsdk/cardinal-character';

export type {
  Curve,
  GeneDef,
  GeneGroup,
  ChainDef,
  MorphDef,
  FamilyDescriptor,
} from './family/types';
export { evalCurve } from './family/proportions';
export { HUMANOID } from './family/humanoid';
export { registerFamily, getFamily, validateDescriptor } from './family/registry';

export type { Genome, RngLike } from './genome/types';
export { clamp01 } from './genome/types';
export { createGenome, defaultGenome, centeredDraw } from './genome/create';
export { breed } from './genome/breed';
export { GENOME_FORMAT_VERSION, packGenome, unpackGenome } from './genome/serialize';

export type {
  Vec3,
  BoneRest,
  RigBinding,
  CompiledBone,
  CompiledCharacter,
} from './compile/types';
export { compile } from './compile/compile';
export { CompileCache, genomeKey } from './compile/memo';

export type { TranslationTrack } from './compile/clips';
export { classifyTranslationTrack, CONSTANT_TRACK_EPSILON } from './compile/clips';

export type { Preset } from './presets/types';
export { METIERS, genomeFromPreset } from './presets/metiers';

import { HUMANOID } from './family/humanoid';
import { registerFamily } from './family/registry';

// Les familles fournies par le paquet s'enregistrent ici, et non dans leur
// propre module : `registry` ne doit connaître aucune famille, sinon ajouter
// une espèce voudrait dire modifier le registre.
registerFamily(HUMANOID);
