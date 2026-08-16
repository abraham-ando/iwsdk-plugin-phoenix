import type { FamilyDescriptor } from '../family/types';
import type { Genome } from './types';

export const GENOME_FORMAT_VERSION = 1;

/**
 * Un gène tient sur un octet.
 *
 * 256 pas sur [0,1] placent l'erreur maximale à 0.2 % d'un gène, très en deçà
 * du seuil de perception sur une largeur d'épaules. Trente gènes tiennent donc
 * en trente octets contre cent vingt en float32 — la même arithmétique que les
 * trames de 33 octets et la compression de quaternion sur 32 bits.
 *
 * L'ordre est celui des clés triées du descripteur, jamais celui de l'objet :
 * deux génomes égaux doivent produire des octets égaux.
 */
export function packGenome(family: FamilyDescriptor, genome: Genome): Uint8Array {
  const keys = Object.keys(family.genes).sort();
  const bytes = new Uint8Array(2 + keys.length);
  bytes[0] = GENOME_FORMAT_VERSION;
  bytes[1] = keys.length;
  for (let i = 0; i < keys.length; i++) {
    const value = genome.genes[keys[i]!] ?? 0.5;
    bytes[2 + i] = Math.round((value < 0 ? 0 : value > 1 ? 1 : value) * 255);
  }
  return bytes;
}

export function unpackGenome(family: FamilyDescriptor, bytes: Uint8Array): Genome {
  if (bytes[0] !== GENOME_FORMAT_VERSION) {
    throw new Error(
      `unpackGenome: version ${bytes[0]} inconnue, attendu ${GENOME_FORMAT_VERSION}`,
    );
  }
  const keys = Object.keys(family.genes).sort();
  if (bytes[1] !== keys.length) {
    throw new Error(
      `unpackGenome: ${bytes[1]} gènes encodés, la famille "${family.id}" en déclare ${keys.length}`,
    );
  }
  const genes: Record<string, number> = {};
  for (let i = 0; i < keys.length; i++) {
    genes[keys[i]!] = bytes[2 + i]! / 255;
  }
  return { family: family.id, genes };
}
