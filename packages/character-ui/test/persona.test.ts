import { describe, it, expect } from 'vitest';
import { PersonaTab, NEED_ROW_IDS, PERSONA_IDS, type PersonaView } from '../src/tabs/persona';
import { makeFakeDocument } from './fixtures/fakeDocument';

const VUE: PersonaView = {
  name: 'Mira', tribe: 'Aube', role: 'Mère & Gardienne',
  persona: "Douce et prévoyante, partage toujours ce qu'elle cueille",
  needs: { hunger: 80, warmth: 60, energy: 100, affection: 40, stress: 10 },
  action: 'gather_berries',
  plan: ['nourrir la famille', 'rentrer avant la nuit'],
};

function build() {
  const ids = [
    ...Object.values(NEED_ROW_IDS).flatMap((r) => [r.label, r.bar, r.value]),
    ...Object.values(PERSONA_IDS),
  ];
  const { doc, props, texts } = makeFakeDocument(ids);
  return { tab: new PersonaTab(doc), props, texts };
}

describe('l onglet Persona', () => {
  it('affiche le nom, le rôle et la tribu', () => {
    const { tab, texts } = build();
    tab.render(VUE);
    expect(texts.get(PERSONA_IDS.role)).toContain('Mira');
    expect(texts.get(PERSONA_IDS.role)).toContain('Aube');
  });

  it('normalise les besoins de 0–100 vers la jauge en 0–1', () => {
    // Le piège : la jauge prend une FRACTION. Passer 80 tel quel donnerait
    // 8000 %, borné à 100 % — donc toutes les barres pleines, et un panneau
    // qui semble marcher.
    const { tab, props } = build();
    tab.render(VUE);
    expect(props.get(NEED_ROW_IDS.warmth.bar)?.width).toBe('60%');
    expect(props.get(NEED_ROW_IDS.affection.bar)?.width).toBe('40%');
    expect(props.get(NEED_ROW_IDS.stress.bar)?.width).toBe('10%');
  });

  it('affiche l action en cours, et « au repos » quand il n y en a pas', () => {
    const { tab, texts } = build();
    tab.render(VUE);
    expect(texts.get(PERSONA_IDS.action)).toContain('gather_berries');
    tab.render({ ...VUE, action: null });
    expect(texts.get(PERSONA_IDS.action)).toContain('repos');
  });

  it('affiche le plan Mode-2, et « aucun plan » quand il est vide', () => {
    const { tab, texts } = build();
    tab.render(VUE);
    expect(texts.get(PERSONA_IDS.plan)).toContain('nourrir la famille');
    tab.render({ ...VUE, plan: [] });
    expect(texts.get(PERSONA_IDS.plan)).toContain('aucun plan');
  });

  it('sans vue, affiche le message d absence et NE LÈVE PAS', () => {
    // C est le cas où l application n a fourni aucun résolveur — l onglet
    // Réglages doit rester pleinement utilisable.
    const { tab, props } = build();
    expect(() => tab.render(null)).not.toThrow();
    expect(props.get(PERSONA_IDS.absent)?.display).toBe('flex');
  });

  it('cache le message d absence dès qu une vue arrive', () => {
    const { tab, props } = build();
    tab.render(null);
    tab.render(VUE);
    expect(props.get(PERSONA_IDS.absent)?.display).toBe('none');
  });
});
