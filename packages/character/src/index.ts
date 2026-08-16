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

import { HUMANOID } from './family/humanoid';
import { registerFamily } from './family/registry';

// Les familles fournies par le paquet s'enregistrent ici, et non dans leur
// propre module : `registry` ne doit connaître aucune famille, sinon ajouter
// une espèce voudrait dire modifier le registre.
registerFamily(HUMANOID);
