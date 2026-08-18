import type { PanelDocument, PanelElement } from '../../src/document';

/**
 * Un document en mémoire qui enregistre ce qu'on lui fait.
 *
 * Il ne connaît QUE les identifiants qu'on lui déclare : demander un
 * identifiant absent rend `null`, exactement comme un vrai document dont
 * l'élément n'existe pas. C'est ce qui permet aux tests de distinguer « le
 * contrôleur n'a rien écrit » de « le contrôleur a écrit ailleurs ».
 */
export function makeFakeDocument(ids: readonly string[]): {
  doc: PanelDocument;
  props: Map<string, Record<string, unknown>>;
  texts: Map<string, string>;
  clicks: Map<string, () => void>;
  journal: string[];
} {
  const props = new Map<string, Record<string, unknown>>();
  const texts = new Map<string, string>();
  const clicks = new Map<string, () => void>();
  const elements = new Map<string, PanelElement>();
  // Chaque ÉCRITURE, dans l'ordre, sous la forme `id:setProperties` ou
  // `id:setText`. `props` et `texts` ne gardent que l'état FINAL : ils ne
  // savent pas distinguer « réécrit à l'identique » de « pas réécrit » — or
  // c'est exactement la question que pose la détection de changement de
  // `SettingsTab`, dont le coût réel est le NOMBRE d'appels uikit.
  const journal: string[] = [];

  for (const id of ids) {
    elements.set(id, {
      setProperties(p) {
        journal.push(`${id}:setProperties`);
        props.set(id, { ...(props.get(id) ?? {}), ...p });
      },
      setText(t) {
        journal.push(`${id}:setText`);
        texts.set(id, t);
      },
      addEventListener(type, handler) {
        if (type === 'click') clicks.set(id, handler);
      },
    });
  }

  return {
    doc: { getElementById: (id) => elements.get(id) ?? null },
    props,
    texts,
    clicks,
    journal,
  };
}
