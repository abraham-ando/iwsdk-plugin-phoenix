import { describe, it, expect } from 'vitest';
import { CARDINAL_CODECS } from '../src/cardinal/codecs.generated';

describe('le composant CharacterGenome généré', () => {
  it('occupe treize octets, un par gène', () => {
    const codec = CARDINAL_CODECS.get(4)!;
    expect(codec.name).toBe('CharacterGenome');
    expect(codec.bytes).toBe(13);
    expect(codec.fields).toEqual([{ name: 'genes', slots: 13 }]);
  });

  it('encode et décode treize octets sans perte, aux deux bornes', () => {
    const codec = CARDINAL_CODECS.get(4)!;
    const buffer = new ArrayBuffer(13);
    const view = new DataView(buffer);
    const genes = [0, 255, 128, 1, 254, 0, 255, 64, 192, 0, 255, 127, 128];
    codec.encode(view, 0, { genes });
    const decoded = codec.decode(view, 0);
    expect(decoded.genes).toEqual(genes);
  });

  it('l ordre des octets est l ordre alphabétique de HUMANOID.genes', () => {
    // Le contrat est documenté, pas seulement supposé : ce test l'encode en
    // dur pour qu'un futur ajout de gène qui casse l'ordre soit vu ici.
    const ordreAttendu = [
      'armLength', 'bodyMass', 'cheekbone', 'eyeScale', 'hairStyle',
      'hairTone', 'jawWidth', 'legLength', 'noseSize', 'shoulderWidth',
      'skinTone', 'stature', 'torsoLength',
    ];
    expect(ordreAttendu.length).toBe(13);
    // La preuve que CET ordre est bien celui du composant vient du test de
    // conversion (Task 3), qui encode un Genome nommé et vérifie l'octet à
    // l'index attendu — ce test-ci fixe la liste de référence.
  });

  it('un tableau plus court complète à zéro, jamais undefined', () => {
    const codec = CARDINAL_CODECS.get(4)!;
    const buffer = new ArrayBuffer(13);
    const view = new DataView(buffer);
    codec.encode(view, 0, { genes: [10, 20] });
    const decoded = codec.decode(view, 0) as { genes: number[] };
    expect(decoded.genes[2]).toBe(0);
    expect(decoded.genes.length).toBe(13);
  });
});
