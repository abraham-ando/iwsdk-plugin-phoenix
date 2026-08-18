import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { CARDINAL_CODECS, Networked, CharacterGenome } from '@iwsdk/plugin-phoenix';
import { HUMANOID, createGenome, type RngLike } from '@iwsdk/cardinal-character';
import { genomeToBytes } from '@iwsdk/cardinal-character-three';

function rng(graine: number): RngLike {
  let etat = graine || 1;
  return { next: () => ((etat = (etat * 1664525 + 1013904223) >>> 0) / 4294967296) };
}

/** Encode un composant Cardinal exactement comme CardinalPublisher le ferait. */
function encoderSurLeFil(genes: number[]): Uint8Array {
  const codec = CARDINAL_CODECS.get(4)!; // CharacterGenome
  const bytes = new Uint8Array(codec.bytes);
  codec.encode(new DataView(bytes.buffer), 0, { genes });
  return bytes;
}

/** Décode et applique exactement comme PhoenixNetworkSystem le ferait à la réception. */
function appliquerReception(entity: ReturnType<World['createEntity']>, wire: Uint8Array): void {
  const codec = CARDINAL_CODECS.get(4)!;
  const data = codec.decode(new DataView(wire.buffer, wire.byteOffset, wire.byteLength), 0);
  CARDINAL_REGISTRY_WRITE(entity, data as { genes: number[] });
}

// `write` généré fait `entity.getVectorView(CharacterGenome, 'genes').set(...)`
// pour un champ multi-slots — reproduit ici sans dépendre du détail interne
// du registre généré, pour ne pas coupler ce test à sa forme exacte.
function CARDINAL_REGISTRY_WRITE(
  entity: ReturnType<World['createEntity']>,
  data: { genes: number[] },
): void {
  // `genes` porte le type synthétique 'Array13U8' (voir components.generated.ts) :
  // pas dans l'union `DataType` fermée d'elics, d'où l'échappatoire de type,
  // même contournement que `villager-network-wiring.test.ts`.
  const vue = (entity as any).getVectorView(CharacterGenome, 'genes');
  data.genes.forEach((v, i) => { vue[i] = v; });
}

describe('la réplication fait converger deux dérivations locales divergentes', () => {
  it('le pair B, après réception, porte le génome du pair A — pas le sien', () => {
    // Deux pairs dérivent délibérément des génomes DIFFÉRENTS pour le même
    // agent — un scénario impossible avec la dérivation déterministe
    // d'aujourd'hui, mais c'est exactement ce que la réplication doit
    // corriger si jamais elle se produisait (schéma de secours divergent,
    // ou futur cas de l'étape 6).
    const genomeA = createGenome(HUMANOID, rng(1));
    const genomeB = createGenome(HUMANOID, rng(2));
    expect(genomeA.genes['stature']).not.toBeCloseTo(genomeB.genes['stature']!, 3);

    const worldB = new World();
    worldB.registerComponent(CharacterGenome);
    const entityB = worldB.createEntity();
    // B pose SA propre dérivation locale à la création — comme le fait
    // réellement upgradeVillagers.
    entityB.addComponent(CharacterGenome, { genes: genomeToBytes(genomeB) });
    expect(Array.from((entityB as any).getVectorView(CharacterGenome, 'genes'))).toEqual(
      genomeToBytes(genomeB),
    );

    // A publie ce qu'il a calculé, sur le fil.
    const surLeFil = encoderSurLeFil(genomeToBytes(genomeA));

    // B reçoit — exactement le chemin de PhoenixNetworkSystem.ts:541.
    appliquerReception(entityB, surLeFil);

    // B porte maintenant le génome de A, pas le sien.
    expect(Array.from((entityB as any).getVectorView(CharacterGenome, 'genes'))).toEqual(
      genomeToBytes(genomeA),
    );
  });

  it('deux publications de la MÊME valeur ne produisent qu un octet-flux identique — le silence attendu de CardinalPublisher', () => {
    const genome = createGenome(HUMANOID, rng(3));
    const premier = encoderSurLeFil(genomeToBytes(genome));
    const second = encoderSurLeFil(genomeToBytes(genome));
    expect(premier).toEqual(second);
  });
});
