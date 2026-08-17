import { describe, it, expect } from 'vitest';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { resolveBinding } from '../src/resolve/resolveBinding';
import type { RigNode } from '../src/resolve/types';

const node = (
  name: string,
  children: RigNode[] = [],
  position = { x: 0, y: 0, z: 0 },
  morphTargetDictionary?: Record<string, number>,
): RigNode => ({
  name, children, position,
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  ...(morphTargetDictionary ? { morphTargetDictionary } : {}),
});

/** Hiérarchie minimale satisfaisant HUMANOID, aux noms Mixamo. */
function rigComplet(): RigNode {
  const p = (y: number) => ({ x: 0, y, z: 0 });
  const hand = (side: string) => node(`mixamorig:${side}Hand`, [], { x: 0.25, y: 0, z: 0 });
  const arm = (side: string) =>
    node(`mixamorig:${side}Shoulder`, [
      node(`mixamorig:${side}Arm`, [
        node(`mixamorig:${side}ForeArm`, [hand(side)], { x: 0.27, y: 0, z: 0 }),
      ], { x: 0.13, y: 0, z: 0 }),
    ], { x: 0.05, y: 0.05, z: 0 });
  const leg = (side: string) =>
    node(`mixamorig:${side}UpLeg`, [
      node(`mixamorig:${side}Leg`, [node(`mixamorig:${side}Foot`, [], p(-0.42))], p(-0.44)),
    ], p(-0.05));

  return node('mixamorig:Hips', [
    node('mixamorig:Spine', [
      node('mixamorig:Spine2', [
        node('mixamorig:Neck', [
          node('mixamorig:Head', [
            node('Wolf3D_Head', [], p(0), { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 }),
          ], p(0.09)),
        ], p(0.16)),
        arm('Left'), arm('Right'),
      ], p(0.14)),
    ], p(0.12)),
    leg('Left'), leg('Right'),
    node('Wolf3D_Body'), node('Wolf3D_Hair'),
  ], p(0.95));
}

describe('resolveBinding — rig complet', () => {
  const { binding, report } = resolveBinding(HUMANOID, rigComplet(), 1.75);

  it('accepte et produit une liaison', () => {
    expect(report.accepted).toBe(true);
    expect(binding).not.toBeNull();
  });

  it('nomme l alias par lequel chaque rôle a matché', () => {
    const head = report.matched.find((m) => m.role === 'head')!;
    expect(head.nodeName).toBe('mixamorig:Head');
    expect(head.viaAlias).toBe('mixamorig:Head');
  });

  it('mesure la position ET la rotation de repos', () => {
    expect(binding!.bones['legL']!.position[1]).toBeCloseTo(-0.44, 6);
    expect(binding!.bones['legL']!.rotation).toEqual([0, 0, 0, 1]);
  });

  it('remonte la parenté par rôle, pas par nom de nœud', () => {
    expect(binding!.bones['footL']!.parentRole).toBe('legL');
    expect(binding!.bones['root']!.parentRole).toBeNull();
  });

  it('saute un nœud sans rôle pour remonter au premier ancêtre qui en a un', () => {
    // Un rig réel intercale des os de torsion ou des locators qui ne portent
    // aucun rôle. Sans ce cas, la marche multi-sauts n'est jamais exercée et un
    // simple `parent.role` passerait tous les autres tests : dans rigComplet(),
    // chaque rôle est directement l'enfant d'un autre rôle.
    const avecTorsion = (n: RigNode): RigNode => {
      if (n.name !== 'mixamorig:LeftArm') return { ...n, children: n.children.map(avecTorsion) };
      return {
        ...n,
        children: [node('mixamorig:LeftArmTwist', n.children.map(avecTorsion))],
      };
    };
    const { binding, report } = resolveBinding(HUMANOID, avecTorsion(rigComplet()), 1.75);
    expect(report.accepted).toBe(true);
    // foreArmL est désormais petit-enfant d'upperArmL, via un nœud sans rôle.
    expect(binding!.bones['foreArmL']!.parentRole).toBe('upperArmL');
  });

  it('résout les index de morphs', () => {
    expect(binding!.morphIndex['jawWidth']).toBe(0);
    expect(binding!.morphIndex['bodyMass']).toBe(4);
  });

  it('reporte la hauteur qu on lui a donnée, sans l inventer', () => {
    expect(binding!.restHeightMeters).toBe(1.75);
  });
});

describe('resolveBinding — rejets et tolérances', () => {
  it('refuse dès qu UN SEUL rôle déclaré manque, et le nomme', () => {
    // Un seul os retiré, sans effet de bord sur ses descendants : c'est le rôle
    // manquant lui-même qui refuse l'asset, pas la perte collatérale d'un autre.
    // `spine` n'est l'extrémité d'aucune chaîne — sous l'ancienne règle (seules
    // les extrémités de chaîne étaient structurelles) ce rig aurait été accepté
    // avec un tronc partiellement mis à l'échelle, exactement le défaut visé.
    const sansSpine = (n: RigNode): RigNode => ({
      ...n,
      children: n.children.flatMap((c) =>
        c.name === 'mixamorig:Spine'
          ? c.children.map(sansSpine) // on remonte ses enfants d'un cran
          : [sansSpine(c)],
      ),
    });
    const { binding, report } = resolveBinding(HUMANOID, sansSpine(rigComplet()), 1.75);
    expect(report.accepted).toBe(false);
    expect(binding).toBeNull();
    expect(report.missingBones).toEqual(['spine']);
  });

  it('accepte un rig sans morphs, mais le dit', () => {
    // Une marionnette : mêmes os, mais aucun maillage ne porte de dictionnaire
    // de morphs (Wolf3D_Head, seul porteur dans rigComplet, est retiré).
    const stripMorphs = (n: RigNode): RigNode => ({
      ...n,
      morphTargetDictionary: undefined,
      children: n.children.map(stripMorphs),
    });
    const marionnette = stripMorphs(rigComplet());
    const sansMorphs = JSON.parse(JSON.stringify(marionnette)) as RigNode;
    const { report } = resolveBinding(HUMANOID, sansMorphs, 1.75);
    expect(report.missingMorphs.length).toBeGreaterThan(0);
  });

  it('est insensible à la casse des noms de nœuds', () => {
    const bas = JSON.parse(JSON.stringify(rigComplet())) as RigNode;
    const lower = (n: RigNode): RigNode => ({ ...n, name: n.name.toLowerCase(), children: n.children.map(lower) });
    expect(resolveBinding(HUMANOID, lower(bas), 1.75).report.accepted).toBe(true);
  });
});
