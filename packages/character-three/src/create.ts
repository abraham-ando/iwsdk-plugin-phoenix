import { Box3, Vector3, type Object3D, type World } from '@iwsdk/core';
import { getFamily, type Genome } from '@iwsdk/cardinal-character';
import { resolveBinding } from './resolve/resolveBinding';
import type { ImportReport } from './resolve/types';
import { SkinnedApplicator } from './apply/SkinnedApplicator';
import { PuppetApplicator } from './apply/PuppetApplicator';
import { CharacterFace, CharacterIdentity, CharacterStructure, CharacterSurface } from './components/index';
import { CharacterCompileSystem } from './systems/CharacterCompileSystem';
import { CharacterExpressionSystem } from './systems/CharacterExpressionSystem';

export interface CreateCharacterOptions {
  familyId: string;
  genome: Genome;
  age: number;
  rigRoot: Object3D;
}

/**
 * Vérifie que chaque os résolu PEND sous `rigRoot`, en remontant `.parent`.
 *
 * L'ancrage (décalage au sol) s'écrit sur le conteneur — jamais sur l'os
 * racine, voir `SkinnedApplicator.applyRestPose` — et cet écrit ne bouge la
 * peau que si les os en sont des descendants réels. Un import glTF place
 * souvent l'armature en FRÈRE du `SkinnedMesh`, pas en enfant : passer le
 * maillage comme `rigRoot` déplacerait alors le conteneur sans jamais
 * atteindre les os. Ni `resolveBinding` ni `ImportReport` ne portent de
 * référence de scène (rôles et transforms seulement) : c'est ici, contre le
 * graphe `Object3D` réel, que l'invariant doit être vérifié — et il doit
 * échouer bruyamment, en nommant l'os fautif, plutôt que produire un
 * personnage dont le sol ne bouge jamais en silence.
 *
 * Cas à part : `rigRoot` porte LUI-MÊME un rôle d'os. `HUMANOID.bones.root`
 * liste `'Armature'` parmi ses alias — le nom que Blender donne justement à
 * l'ancêtre commun qu'on recommande de passer comme conteneur — donc ce cas
 * se présente pour un rig tout à fait correctement formé, pas pour une
 * erreur d'appelant. On le refuse quand même : `applyRestPose` écrirait
 * D'ABORD la position locale de repos de l'os racine sur `rigRoot.position`
 * (X et Z compris, pas seulement Y), puis le décalage au sol par-dessus,
 * mêlant la morphologie du personnage à l'endroit où l'appelant l'a placé.
 */
export function assertBonesAreDescendants(
  rigRoot: Object3D,
  bones: ReadonlyMap<string, Object3D>,
): void {
  for (const [role, node] of bones) {
    if (node === rigRoot) {
      throw new Error(
        `createCharacter: le conteneur "${rigRoot.name || '<sans nom>'}" porte lui-même le rôle ` +
        `d'os "${role}" — c'est le cas d'une armature Blender passée directement comme rigRoot. ` +
        `Enveloppez le rig dans un Group parent et passez-le comme rigRoot : l'ancrage au sol ` +
        `s'écrit sur le conteneur, et l'écrire sur un os mêlerait la morphologie du personnage à ` +
        `l'endroit où il se tient.`,
      );
    }
  }

  for (const [role, node] of bones) {
    let cursor: Object3D | null = node.parent;
    let isDescendant = false;
    while (cursor !== null) {
      if (cursor === rigRoot) { isDescendant = true; break; }
      cursor = cursor.parent;
    }
    if (!isDescendant) {
      throw new Error(
        `createCharacter: l'os "${role}" (nœud "${node.name}") n'est pas un descendant de rigRoot ` +
        `("${rigRoot.name || '<sans nom>'}") — le décalage au sol s'écrit sur rigRoot et ne peut ` +
        `atteindre la peau que si les os pendent dessous. Un import glTF place souvent l'armature ` +
        `en frère du SkinnedMesh : passez leur ancêtre commun comme rigRoot.`,
      );
    }
  }
}

/**
 * Le seul chemin d'entrée. Mesure la boîte englobante de l'asset ENTIER dans sa
 * pose de repos, avant toute morphologie — c'est la hauteur de référence que le
 * génome module ensuite.
 */
export function createCharacter(
  world: World,
  options: CreateCharacterOptions,
): { entity: ReturnType<World['createTransformEntity']>; report: ImportReport } {
  const family = getFamily(options.familyId);
  // Boîte englobante de l'asset ENTIER dans sa pose de repos, avant toute
  // morphologie : c'est la hauteur de référence que le génome module ensuite.
  const height = new Box3().setFromObject(options.rigRoot).getSize(new Vector3()).y;
  const { binding, report } = resolveBinding(family, options.rigRoot as never, height);

  const entity = world.createTransformEntity(options.rigRoot);
  if (binding === null) return { entity, report };

  const bones = new Map<string, Object3D>();
  options.rigRoot.traverse((node) => {
    const match = report.matched.find((m) => m.nodeName === node.name);
    if (match !== undefined) bones.set(match.role, node);
  });

  // Doit précéder la construction de l'applicateur : un no-op silencieux sur
  // le décalage au sol est précisément le défaut que ce projet refuse.
  assertBonesAreDescendants(options.rigRoot, bones);

  const meshes: any[] = [];
  options.rigRoot.traverse((node) => {
    if ((node as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) meshes.push(node);
  });

  const ramps: Record<string, readonly [string, string]> = {};
  for (const [key, gene] of Object.entries(family.genes)) {
    if (gene.group === 'surface' && gene.ramp !== undefined) ramps[key] = gene.ramp;
  }

  // Les cibles de teinte viennent de la LIAISON, jamais d'une seconde marche
  // du graphe : le résolveur les a déjà appariées, insensiblement à la casse,
  // et c'est la même comparaison qui a décidé de `missingSurfaces`.
  const surfaceTargets = binding.surfaceTargets;

  // Le choix se fait sur ce qu'on a TROUVÉ, pas sur une option : un asset qui
  // porte un SkinnedMesh est skinné, point.
  const applicator =
    meshes.length > 0
      ? new SkinnedApplicator({
          rigRoot: options.rigRoot, bones, meshes,
          morphIndex: binding.morphIndex, surfaceTargets, ramps,
        })
      : new PuppetApplicator({ rigRoot: options.rigRoot, nodes: bones, surfaceTargets, ramps });

  entity.addComponent(CharacterIdentity, { family: family.id, age: options.age });
  entity.addComponent(CharacterStructure, {});
  entity.addComponent(CharacterFace, {});
  entity.addComponent(CharacterSurface, {});

  const compiler = world.getSystem(CharacterCompileSystem) as CharacterCompileSystem;
  compiler.applicators.set(entity.index, applicator);
  compiler.bindings.set(entity.index, binding);
  compiler.genomes.set(entity.index, options.genome);

  return { entity, report };
}

export function installCharacterThree(world: World): void {
  world
    .registerComponent(CharacterIdentity)
    .registerComponent(CharacterStructure)
    .registerComponent(CharacterFace)
    .registerComponent(CharacterSurface);
  world.registerSystem(CharacterCompileSystem, { priority: 60 });
  world.registerSystem(CharacterExpressionSystem, { priority: 70 });
}
