import { HUMANOID, type Genome, type FamilyDescriptor } from '@iwsdk/cardinal-character';

/** Les treize gènes, dans l'ordre alphabétique — le même que createGenome(). */
function orderedGeneKeys(family: FamilyDescriptor): string[] {
  return Object.keys(family.genes).sort();
}

/**
 * Un `Genome` (flottants `[0,1]`) vers treize octets, dans l'ordre
 * alphabétique des clés de la famille — le format que `CharacterGenome`
 * transporte sur le fil.
 *
 * 256 pas par gène : `Math.round(valeur * 255)`, jamais tronqué — un
 * `Math.floor` biaiserait systématiquement vers le bas.
 */
export function genomeToBytes(genome: Genome): number[] {
  const family = genome.family === HUMANOID.id ? HUMANOID : undefined;
  if (family === undefined) {
    throw new Error(`genomeToBytes: famille inconnue "${genome.family}"`);
  }
  return orderedGeneKeys(family).map((cle) => {
    const valeur = genome.genes[cle] ?? 0.5;
    return Math.max(0, Math.min(255, Math.round(valeur * 255)));
  });
}

/**
 * L'inverse : treize octets vers un `Genome`. Un tableau plus court que
 * treize ne lève pas — les index manquants retombent sur `0.5`, le même
 * défaut que `Genome.genes[cle] ?? 0.5` applique déjà ailleurs dans ce
 * projet pour un gène absent.
 */
export function bytesToGenome(family: FamilyDescriptor, bytes: readonly number[]): Genome {
  const genes: Record<string, number> = {};
  orderedGeneKeys(family).forEach((cle, i) => {
    genes[cle] = (bytes[i] ?? 128) / 255;
  });
  return { family: family.id, genes };
}
