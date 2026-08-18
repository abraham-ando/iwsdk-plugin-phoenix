import { describe, it, expect } from 'vitest';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { SettingsTab, GENE_ROW_IDS, GENE_STEP, NON_EDITABLE_GENES } from '../src/tabs/settings';
import { makeFakeDocument } from './fixtures/fakeDocument';

/** Tous les identifiants que l'onglet peut demander. */
function tousLesIds(): string[] {
  return Object.values(GENE_ROW_IDS).flatMap((r) => [
    r.row, r.bar, r.value, r.minus, r.plus, r.label, r.note,
  ]);
}

function build(inertes: readonly string[] = []) {
  const { doc, props, texts, clicks } = makeFakeDocument(tousLesIds());
  const valeurs = new Map<string, number>();
  for (const cle of Object.keys(HUMANOID.genes)) valeurs.set(cle, 0.5);
  const ecrits: Array<[string, number]> = [];
  const tab = new SettingsTab(doc, {
    read: (g) => valeurs.get(g) ?? 0.5,
    write: (g, v) => {
      valeurs.set(g, v);
      ecrits.push([g, v]);
    },
    inertGenes: () => new Set(inertes),
  });
  return { tab, props, texts, clicks, valeurs, ecrits };
}

describe('l onglet Réglages', () => {
  it('affiche une ligne par gène de la famille', () => {
    const { tab, texts } = build();
    tab.refresh();
    expect(Object.keys(GENE_ROW_IDS).length).toBe(Object.keys(HUMANOID.genes).length);
    expect(texts.get(GENE_ROW_IDS['stature']!.value)).toBe('0.50');
  });

  it('« + » avance d exactement un pas, et écrit le gène demandé', () => {
    const { tab, clicks, ecrits } = build();
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.plus)?.();
    expect(ecrits).toEqual([['stature', 0.5 + GENE_STEP]]);
  });

  it('« − » recule d exactement un pas', () => {
    const { tab, clicks, ecrits } = build();
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.minus)?.();
    expect(ecrits).toEqual([['stature', 0.5 - GENE_STEP]]);
  });

  it('borne à [0,1] au lieu de sortir de l intervalle du gène', () => {
    const { tab, clicks, valeurs, ecrits } = build();
    valeurs.set('stature', 1);
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.plus)?.();
    expect(ecrits).toEqual([['stature', 1]]);
    valeurs.set('stature', 0);
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.minus)?.();
    expect(ecrits[1]).toEqual(['stature', 0]);
  });

  it('grise les gènes inertes et cache leurs boutons', () => {
    const { tab, props } = build(['jawWidth']);
    tab.refresh();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.minus)?.display).toBe('none');
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('none');
    expect(props.get(GENE_ROW_IDS['jawWidth']!.row)?.opacity).toBe(0.4);
    // Et il DIT pourquoi. Une ligne grise sans raison est une panne muette.
    expect(props.get(GENE_ROW_IDS['jawWidth']!.note)?.display).toBe('flex');
  });

  it('un clic sur un gène inerte n écrit rien', () => {
    // Le garde qui compte : cacher le bouton ne suffit pas si le gestionnaire
    // reste branché — un rayon peut encore l atteindre.
    const { tab, clicks, ecrits } = build(['jawWidth']);
    tab.refresh();
    clicks.get(GENE_ROW_IDS['jawWidth']!.plus)?.();
    expect(ecrits).toEqual([]);
  });

  it('rallume une ligne quand le gène cesse d être inerte', () => {
    // La liste vient du rapport d import de la CIBLE : changer de cible change
    // la liste, et une ligne éteinte doit pouvoir se rallumer.
    const { doc, props, clicks } = makeFakeDocument(tousLesIds());
    let inertes = new Set(['jawWidth']);
    const tab = new SettingsTab(doc, {
      read: () => 0.5,
      write: () => {},
      inertGenes: () => inertes,
    });
    tab.refresh();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('none');
    inertes = new Set();
    tab.refresh();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('flex');
    void clicks;
  });

  it('le pas vient du schéma ECS, pas d une constante recopiée', () => {
    expect(GENE_STEP).toBe(0.01);
  });

  it('les trois gènes de surface ne sont pas éditables, et pour une autre raison', () => {
    // `CharacterSurface` ne porte que `skin` et `hair`, deux Types.Color :
    // les couleurs RÉSOLUES. Aucun champ scalaire n accueille `skinTone`,
    // `hairTone` ni `hairStyle` — les éditer voudrait dire écrire le génome,
    // qui n a pas de mutateur public. Sans ce garde, un clic les enverrait
    // vers CharacterFace, qui ne les a pas non plus.
    expect([...NON_EDITABLE_GENES].sort()).toEqual(['hairStyle', 'hairTone', 'skinTone']);
    const { tab, clicks, ecrits, props } = build();
    tab.refresh();
    clicks.get(GENE_ROW_IDS['skinTone']!.plus)?.();
    expect(ecrits).toEqual([]);
    expect(props.get(GENE_ROW_IDS['skinTone']!.plus)?.display).toBe('none');
  });
});
