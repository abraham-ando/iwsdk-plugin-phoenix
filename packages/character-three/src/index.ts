export type { CharacterApplicator } from './apply/types';
export { SkinnedApplicator, type SkinnedApplicatorOptions } from './apply/SkinnedApplicator';
export { PuppetApplicator, type PuppetApplicatorOptions } from './apply/PuppetApplicator';
export { rampColour } from './apply/ramp';
export { cloneMaterials, disposeMaterials } from './apply/materials';

export type { RigNode, ImportReport } from './resolve/types';
export { resolveBinding } from './resolve/resolveBinding';

export { sanitizeClip } from './clips/sanitize';
export { applyRootMotionPolicy, type RootMotionPolicy } from './clips/rootMotion';

export {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from './components/index';

export {
  CharacterCompileSystem, genomeFromComponents, needsRecompile,
} from './systems/CharacterCompileSystem';
export { CharacterExpressionSystem } from './systems/CharacterExpressionSystem';

export {
  createCharacter, installCharacterThree, assertBonesAreDescendants,
  type CreateCharacterOptions,
} from './create';
