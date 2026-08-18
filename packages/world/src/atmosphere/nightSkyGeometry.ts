/**
 * La géométrie du ciel nocturne, en fonctions pures.
 *
 * Le placement des étoiles doit être DÉTERMINISTE : deux joueurs d'une même
 * session, deux exécutions d'un même enregistrement, doivent voir la même
 * voûte. Un `Math.random()` par étoile suffirait à rendre le ciel différent
 * à chaque chargement — et personne ne s'en apercevrait avant longtemps.
 */

/** Hachage entier stable, même famille que le bruit du terrain. */
function hash(i: number): number {
  let h = (i + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Positions des étoiles sur une demi-sphère de rayon donné, réparties
 * uniformément par la méthode de l'aire égale — sans quoi elles
 * s'agglutineraient au zénith, ce que l'œil repère immédiatement.
 *
 * Rend un tableau plat de `count * 3` flottants, prêt pour un attribut.
 */
export function starPositions(count: number, radius: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Aire égale : cos(θ) uniforme sur [0, 1] couvre l'hémisphère supérieur
    // sans concentration au pôle.
    const cosTheta = hash(i * 2 + 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = hash(i * 2 + 2) * Math.PI * 2;
    out[i * 3] = radius * sinTheta * Math.cos(phi);
    out[i * 3 + 1] = radius * cosTheta;
    out[i * 3 + 2] = radius * sinTheta * Math.sin(phi);
  }
  return out;
}

/** Éclat propre de chaque étoile, dans [0.35, 1] : un ciel uniforme est faux. */
export function starBrightness(count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = 0.35 + hash(i * 7 + 3) * 0.65;
  return out;
}

/**
 * Direction d'un astre sur la voûte, depuis son élévation et son azimut.
 *
 * L'azimut est compté depuis le nord et croît vers l'est, comme le rend
 * `solarPosition`. Le repère du monde a `-Z` au nord.
 */
export function skyDirection(
  elevationDeg: number,
  azimuthDeg: number,
  radius: number
): [number, number, number] {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const horizontal = Math.cos(el) * radius;
  return [horizontal * Math.sin(az), Math.sin(el) * radius, -horizontal * Math.cos(az)];
}
