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
} {
  const props = new Map<string, Record<string, unknown>>();
  const texts = new Map<string, string>();
  const clicks = new Map<string, () => void>();
  const elements = new Map<string, PanelElement>();

  for (const id of ids) {
    elements.set(id, {
      setProperties(p) {
        props.set(id, { ...(props.get(id) ?? {}), ...p });
      },
      setText(t) {
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
  };
}
