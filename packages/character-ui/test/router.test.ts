import { describe, it, expect } from 'vitest';
import { TabRouter, TAB_IDS, TAB_BUTTON_IDS } from '../src/router';
import { makeFakeDocument } from './fixtures/fakeDocument';

function build() {
  const { doc, props, clicks } = makeFakeDocument([
    ...Object.values(TAB_IDS),
    ...Object.values(TAB_BUTTON_IDS),
  ]);
  return { router: new TabRouter(doc), props, clicks };
}

describe('le routeur d onglets', () => {
  it('ouvre sur Réglages', () => {
    const { router } = build();
    expect(router.current).toBe('settings');
  });

  it('un seul onglet est visible à la fois', () => {
    const { router, props } = build();
    router.show('persona');
    expect(props.get(TAB_IDS.persona)?.display).toBe('flex');
    expect(props.get(TAB_IDS.settings)?.display).toBe('none');

    router.show('settings');
    expect(props.get(TAB_IDS.settings)?.display).toBe('flex');
    expect(props.get(TAB_IDS.persona)?.display).toBe('none');
  });

  it('le bouton d onglet change la route', () => {
    const { router, clicks } = build();
    clicks.get(TAB_BUTTON_IDS.persona)?.();
    expect(router.current).toBe('persona');
  });

  it('marque le bouton actif, et un seul', () => {
    // Sans ce garde, les deux boutons peuvent rester allumés : `classList` est
    // additif, et oublier le `remove` ne casse rien de visible en test.
    //
    // Renforcement : le routeur démarre sur `settings`, donc un show('persona')
    // isolé suffit déjà à démasquer une implémentation qui n'éteint jamais le
    // bouton précédent (il resterait à 1 au lieu de 0.35 — vérifié par mutation).
    // Mais un routeur incrémental peut très bien traiter cette transition sans
    // bug tout en oubliant le trajet retour ; sans le second aller-retour
    // ci-dessous, une implémentation ainsi biaisée passe inaperçue (vérifié
    // par mutation également). L'aller-retour ferme ce trou.
    const { router, props } = build();
    router.show('persona');
    expect(props.get(TAB_BUTTON_IDS.persona)?.backgroundOpacity).toBe(1);
    expect(props.get(TAB_BUTTON_IDS.settings)?.backgroundOpacity).toBe(0.35);

    router.show('settings');
    expect(props.get(TAB_BUTTON_IDS.settings)?.backgroundOpacity).toBe(1);
    expect(props.get(TAB_BUTTON_IDS.persona)?.backgroundOpacity).toBe(0.35);
  });

  it('ne lève pas quand un élément manque du document', () => {
    // Un document incomplet est un bug, mais il ne doit pas emporter la frame.
    const { doc } = makeFakeDocument([]);
    const router = new TabRouter(doc);
    expect(() => router.show('persona')).not.toThrow();
  });
});
