import type { BoneRest, FamilyDescriptor, RigBinding } from '@iwsdk/cardinal-character';
import type { ImportReport, RigNode } from './types';

export function resolveBinding(
  family: FamilyDescriptor,
  root: RigNode,
  restHeightMeters: number,
): { binding: RigBinding | null; report: ImportReport } {
  // Index des nœuds par nom minuscule : `mixamorig:Hips` et `mixamorig:hips`
  // désignent le même os selon l'exportateur. Deux noms RÉELLEMENT distincts
  // qui ne diffèrent que par la casse entreraient en collision ici — le
  // dernier rencontré par la marche gagnerait en silence. Un rig cohérent ne
  // fait pas ça ; ce n'est pas une garantie que ce résolveur donne.
  const byName = new Map<string, { node: RigNode; parent: RigNode | null }>();
  const walk = (node: RigNode, parent: RigNode | null): void => {
    byName.set(node.name.toLowerCase(), { node, parent });
    for (const child of node.children) walk(child, node);
  };
  walk(root, null);

  const report: ImportReport = {
    family: family.id, matched: [], missingBones: [],
    missingMorphs: [], missingSurfaces: [], accepted: false,
  };

  // 1. Les os, par alias, dans l'ordre de préférence du descripteur.
  const nodeOfRole = new Map<string, RigNode>();
  for (const [role, aliases] of Object.entries(family.bones)) {
    const hit = aliases
      .map((alias) => ({ alias, found: byName.get(alias.toLowerCase()) }))
      .find((c) => c.found !== undefined);
    if (hit === undefined) {
      report.missingBones.push(role);
      continue;
    }
    nodeOfRole.set(role, hit.found!.node);
    report.matched.push({ role, nodeName: hit.found!.node.name, viaAlias: hit.alias });
  }

  // 2. Les morphs : absents, ils sont dits mais ne bloquent pas.
  const morphIndex: Record<string, number> = {};
  for (const [key, def] of Object.entries(family.morphs)) {
    let found = false;
    for (const { node } of byName.values()) {
      const dict = node.morphTargetDictionary;
      if (dict === undefined) continue;
      const alias = def.aliases.find((a) => dict[a] !== undefined);
      if (alias !== undefined) {
        morphIndex[key] = dict[alias]!;
        found = true;
        break;
      }
    }
    if (!found) report.missingMorphs.push(key);
  }

  // 3. Les cibles de surface, sur le même mécanisme d'alias. Seule leur
  //    absence intéresse ce rapport : `ImportReport` ne déclare pas de champ
  //    pour les noms trouvés, donc ils ne sont pas conservés ici. Un appelant
  //    Three qui en a besoin (l'applicateur skinné) les retrouvera lui-même
  //    sur le graphe réel, avec le même mécanisme d'alias.
  for (const [key, gene] of Object.entries(family.genes)) {
    if (gene.group !== 'surface') continue;
    const aliases = family.surfaces?.[key]?.aliases ?? [];
    const found = aliases.some((a) => byName.has(a.toLowerCase()));
    if (!found) report.missingSurfaces.push(key);
  }

  // TOUT rôle déclaré est structurel. Ne rendre obligatoires que les extrémités
  // de chaîne laisserait un os intermédiaire non apparié être sauté en silence
  // par la marche de `chainRoles`, qui remonte de rôle en rôle : son segment ne
  // serait jamais mis à l'échelle pendant que ses voisins le seraient. Une
  // famille déclare un rôle parce qu'elle en a besoin.
  if (report.missingBones.length > 0) return { binding: null, report };

  // 4. La parenté est exprimée en RÔLES : le nœud parent immédiat peut très
  //    bien n'avoir aucun rôle, il faut remonter jusqu'au premier qui en a un.
  const roleOfNode = new Map<RigNode, string>();
  for (const [role, node] of nodeOfRole) roleOfNode.set(node, role);

  const bones: Record<string, BoneRest> = {};
  for (const [role, node] of nodeOfRole) {
    let parentRole: string | null = null;
    let cursor = byName.get(node.name.toLowerCase())!.parent;
    while (cursor !== null) {
      const found = roleOfNode.get(cursor);
      if (found !== undefined) { parentRole = found; break; }
      cursor = byName.get(cursor.name.toLowerCase())!.parent;
    }
    bones[role] = {
      role,
      position: [node.position.x, node.position.y, node.position.z],
      rotation: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
      parentRole,
    };
  }

  report.accepted = true;
  return { binding: { family: family.id, bones, morphIndex, restHeightMeters }, report };
}
