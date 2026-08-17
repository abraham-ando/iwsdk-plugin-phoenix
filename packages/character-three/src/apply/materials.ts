import type { Material, Object3D } from '@iwsdk/core';

/**
 * Remplace le matériau d'un nœud par un clone qui NOUS appartient, et empile ce
 * clone dans `owned` pour qu'un `dispose()` puisse le libérer.
 *
 * Un clone par individu, comme le §7.4 de la conception l'exige : « muter le
 * matériau partagé recolorerait tout le village ». `Object3D.clone()` partage
 * ses matériaux, et un asset chargé une fois puis instancié quarante fois les
 * partage aussi — le premier villageois repeindrait donc les trente-neuf
 * autres, et le défaut se présenterait comme « tout le monde a la même peau »,
 * très loin de sa cause.
 *
 * Le clone nous appartient, donc `dispose()` le libère ; les textures, elles,
 * restent celles de la bibliothèque et ne sont pas touchées — `Material.clone()`
 * copie les RÉFÉRENCES de textures, et disposer un matériau ne dispose pas ses
 * textures.
 */
export function cloneMaterials(node: Object3D, owned: Material[]): void {
  // `Object3D` ne déclare pas `material` : seuls `Mesh` et ses dérivés en ont
  // un, et un nœud de teinte peut parfaitement être un `Group` sans matériau.
  const holder = node as unknown as { material?: Material | Material[] };
  const current = holder.material;
  if (current === undefined || current === null) return;

  if (Array.isArray(current)) {
    // Un maillage multi-groupes porte un matériau par groupe : tous nous
    // appartiennent, sinon un seul groupe resterait partagé.
    const clones = current.map((material) => material.clone());
    holder.material = clones;
    for (const clone of clones) owned.push(clone);
    return;
  }

  const clone = current.clone();
  holder.material = clone;
  owned.push(clone);
}

/** Libère les clones et vide la liste. Idempotent. */
export function disposeMaterials(owned: Material[]): void {
  for (const material of owned) material.dispose();
  owned.length = 0;
}
