import { Box3, Group, Vector3, type Object3D, type World } from '@iwsdk/core';
import { getFamily, type Genome } from '@iwsdk/cardinal-character';
import { resolveBinding } from './resolve/resolveBinding';
import type { ImportReport } from './resolve/types';
import { SkinnedApplicator } from './apply/SkinnedApplicator';
import { PuppetApplicator } from './apply/PuppetApplicator';
import {
  CharacterFace, CharacterIdentity, CharacterSelection,
  CharacterStructure, CharacterSurface,
} from './components/index';
import { CharacterCompileSystem } from './systems/CharacterCompileSystem';
import { CharacterExpressionSystem } from './systems/CharacterExpressionSystem';
import { CharacterAnimationSystem } from './systems/CharacterAnimationSystem';

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
 *
 * **Aucune des deux boucles ne peut plus se déclencher depuis
 * `createCharacter`** : celle-ci construit désormais elle-même l'ancre
 * (`CharacterGroundAnchor`) et y reparente le rig, donc les os en sont des
 * descendants par construction et l'ancre ne porte aucun rôle. La fonction
 * reste exportée et vérifiée : elle est le filet d'un futur remaniement qui
 * passerait un autre nœud à l'applicateur, et elle documente l'invariant que
 * l'ancre satisfait. Ce que `createCharacter` refuse bruyamment, c'est un
 * autre défaut — un rig dont le résolveur ne trouve pas les os, voir plus bas.
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
 * Les valeurs initiales d'un composant de gènes, prises dans le génome.
 *
 * Sans cet amorçage, `addComponent(CharacterStructure, {})` laisse les cinq
 * champs au défaut `0.5` du schéma — et `refreshGenes` LIT LE COMPOSANT en
 * priorité pour les gènes de structure, ce qui jetait silencieusement le génome
 * reçu. Onze villageois tirés de onze génomes distincts se retrouvaient avec le
 * même corps.
 *
 * La priorité au composant est voulue : c'est elle qui permettra à un panneau de
 * réglages d'éditer un personnage vivant. Ce qui manquait, c'était le point de
 * départ.
 */
function genesFor(
  schema: Readonly<Record<string, unknown>>,
  genome: Genome,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of Object.keys(schema)) {
    const value = genome.genes[key];
    if (value !== undefined) values[key] = value;
  }
  return values;
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

  // Un rig refusé LÈVE, et lève avant d'avoir créé quoi que ce soit.
  //
  // Rendre une entité sans composants, sans applicateur, sans un mot, était le
  // chemin le plus SILENCIEUX de tout ce paquet — alors que c'est celui que la
  // documentation décrit comme le rejet bruyant. C'est aussi le chemin que
  // prend le motif glTF classique (armature FRÈRE du `SkinnedMesh`, maillage
  // passé comme `rigRoot`) : aucun os trouvé, donc `binding` nul. Un appelant
  // ne peut rien faire d'un personnage sans applicateur, sinon le découvrir
  // plus tard sous la forme d'un mannequin qui ne bouge jamais.
  if (binding === null) {
    throw new Error(
      `createCharacter: rig refusé pour la famille "${family.id}" — os manquants : ` +
      `${report.missingBones.join(', ')}. Tout rôle déclaré par la famille est ` +
      `structurel. Vérifiez les noms de nœuds, ou passez l'ancêtre commun du ` +
      `maillage et de l'armature comme rigRoot : un import glTF place souvent ` +
      `l'armature en frère du SkinnedMesh, et le maillage seul ne porte aucun os.`,
    );
  }

  // TROIS niveaux, et le niveau du milieu est la raison de cette fonction.
  //
  //   CharacterEntity        ← `entity.object3D`, donc la vue `Transform` :
  //     └ CharacterGroundAnchor    l'endroit où l'application pose le
  //         └ options.rigRoot      personnage (hauteur du terrain, point
  //             └ os…              d'apparition).
  //
  // L'applicateur écrit `position.y = groundOffsetMeters` par AFFECTATION, et
  // non par addition — l'ancrage est une propriété de la morphologie, pas un
  // delta. Sans ce nœud intermédiaire, cette affectation tomberait sur le nœud
  // d'entité et détruirait le placement de l'application à la première
  // compilation, puis à chacune des suivantes. C'est exactement le mélange que
  // le §7.2 de la conception refuse : « la morphologie du personnage et
  // l'endroit où il se tient sont deux choses distinctes ».
  const anchor = new Group();
  anchor.name = 'CharacterGroundAnchor';
  anchor.add(options.rigRoot);
  const outer = new Group();
  outer.name = 'CharacterEntity';
  outer.add(anchor);

  const entity = world.createTransformEntity(outer);

  const bones = new Map<string, Object3D>();
  options.rigRoot.traverse((node) => {
    const match = report.matched.find((m) => m.nodeName === node.name);
    if (match !== undefined) bones.set(match.role, node);
  });

  // Doit précéder la construction de l'applicateur : un no-op silencieux sur
  // le décalage au sol est précisément le défaut que ce projet refuse.
  assertBonesAreDescendants(anchor, bones);

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
  // `rigRoot` de l'applicateur = l'ANCRE, jamais le nœud d'entité.
  const applicator =
    meshes.length > 0
      ? new SkinnedApplicator({
          rigRoot: anchor, bones, meshes,
          morphIndex: binding.morphIndex, surfaceTargets, ramps,
        })
      : new PuppetApplicator({ rigRoot: anchor, nodes: bones, surfaceTargets, ramps });

  entity.addComponent(CharacterIdentity, { family: family.id, age: options.age });
  entity.addComponent(CharacterStructure, genesFor(CharacterStructure.schema, options.genome));
  entity.addComponent(CharacterFace, genesFor(CharacterFace.schema, options.genome));
  // CharacterSurface reste amorcé à vide : ses deux champs sont des
  // Types.Color (des VECTEURS), écrits par getVectorView à la compilation —
  // voir CharacterCompileSystem. Les initialiser ici par addComponent
  // n'apporterait rien et brouillerait la source de vérité.
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
    .registerComponent(CharacterSurface)
    // Le cinquième, oublié : un composant non enregistré n'a pas de bitmask,
    // donc `addComponent` lève à la première tentative d'un panneau
    // d'inspection — le seul code qui s'en sert, et qui n'existe pas encore.
    .registerComponent(CharacterSelection);
  world.registerSystem(CharacterCompileSystem, { priority: 60 });
  world.registerSystem(CharacterExpressionSystem, { priority: 70 });
  // 80 : le mixer tourne APRÈS que la morphologie de la frame est posée.
  world.registerSystem(CharacterAnimationSystem, { priority: 80 });
}

export interface CreateCharacterFromAssetOptions {
  /** Identifiant du manifeste — jamais une URL : le chargement passe par `AssetManager`. */
  assetId: string;
  familyId: string;
  genome: Genome;
  age: number;
}

/**
 * Instancie un rig depuis le manifeste et le fait entrer dans le pont.
 *
 * `world.assets.instantiate` rend `gltf.scene` d'un clone obtenu par
 * `SkeletonUtils.clone` — donc un `Skeleton` et des os NEUFS à chaque appel,
 * ce qui est la condition pour que onze villageois portent onze morphologies
 * sur deux assets de base. Géométries, matériaux et clips restent partagés par
 * référence : c'est pourquoi l'applicateur clone ses matériaux et l'assainisseur
 * rend un nouveau clip.
 *
 * Le nœud rendu est la racine de scène, c'est-à-dire l'ANCÊTRE COMMUN de
 * l'armature et du `SkinnedMesh` — exactement ce que `createCharacter` exige.
 * Un import glTF place souvent l'armature en frère du maillage ; passer le
 * maillage seul ferait lever le pont.
 *
 * Deux échecs remontent, et ils doivent rester distinguables : le chargement
 * (identifiant inconnu, réseau) lève depuis `AssetManager` ; le refus de rig
 * lève depuis `createCharacter` avec la liste des os manquants.
 */
export async function createCharacterFromAsset(
  world: World,
  options: CreateCharacterFromAssetOptions,
): Promise<{ entity: ReturnType<World['createTransformEntity']>; report: ImportReport }> {
  const rigRoot = await world.assets.instantiate<Object3D>(options.assetId);
  return createCharacter(world, {
    familyId: options.familyId,
    genome: options.genome,
    age: options.age,
    rigRoot,
  });
}
