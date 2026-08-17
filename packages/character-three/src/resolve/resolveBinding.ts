import type { BoneRest, FamilyDescriptor, RigBinding } from '@iwsdk/cardinal-character';
import type { ImportReport, RigNode } from './types';

/** Les rôles sans lesquels un personnage ne peut pas être compilé. */
function requiredRoles(family: FamilyDescriptor): Set<string> {
  const roles = new Set<string>([family.rootRole, family.headRole]);
  if (family.groundRole !== undefined) roles.add(family.groundRole);
  for (const chain of Object.values(family.chains)) {
    roles.add(chain.from);
    roles.add(chain.to);
    if (chain.mirror !== undefined) {
      roles.add(chain.mirror[0]);
      roles.add(chain.mirror[1]);
    }
  }
  return roles;
}

export function resolveBinding(
  family: FamilyDescriptor,
  root: RigNode,
  restHeightMeters: number,
): { binding: RigBinding | null; report: ImportReport } {
  // Index des nœuds par nom minuscule : `mixamorig:Hips` et `mixamorig:hips`
  // désignent le même os selon l'exportateur.
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

  const required = requiredRoles(family);
  const fatal = report.missingBones.filter((role) => required.has(role));

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

  // 3. Les cibles de surface, sur le même mécanisme d'alias.
  const surfaceTargets: Record<string, readonly string[]> = {};
  for (const [key, gene] of Object.entries(family.genes)) {
    if (gene.group !== 'surface') continue;
    const aliases = family.surfaces?.[key]?.aliases ?? [];
    const hits = aliases
      .map((a) => byName.get(a.toLowerCase())?.node.name)
      .filter((n): n is string => n !== undefined);
    if (hits.length === 0) report.missingSurfaces.push(key);
    else surfaceTargets[key] = hits;
  }

  if (fatal.length > 0) return { binding: null, report };

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
