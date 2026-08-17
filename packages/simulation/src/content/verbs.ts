import { SmartObjectRegistry } from '../world/SmartObject';
import { registerDefaultContent } from './objects';
import { defaultIntrinsics } from '../agents/intrinsics';

/**
 * Tous les verbes que le contenu déclare — affordances d'objets et gestes
 * propres confondus, triés et sans doublon.
 *
 * La narration du HUD tenait sa propre liste, et en avait oublié deux :
 * « Narek hunt. » et « Aya eat_meat. » s'affichaient en anglais au milieu du
 * français. Une source unique rend l'oubli détectable par un test plutôt que
 * par un œil sur une chronique qui défile.
 */
export function contentVerbs(): string[] {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  const verbes = new Set<string>();
  for (const type of registry.types()) {
    for (const affordance of registry.get(type).affordances) verbes.add(affordance.verb);
  }
  for (const intrinsic of defaultIntrinsics()) verbes.add(intrinsic.verb);
  return [...verbes].sort();
}
