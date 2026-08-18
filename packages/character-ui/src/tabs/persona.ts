import { renderGauge } from '../gauge';
import { show, setText, type PanelDocument } from '../document';

export type NeedId = 'hunger' | 'warmth' | 'energy' | 'affection' | 'stress';

/**
 * Ce dont l'onglet a besoin, et rien de plus.
 *
 * Le paquet ne dépend PAS de `@iwsdk/cardinal-simulation` : `CharacterSelection`
 * porte une entité, l'état d'un agent se lit par identifiant, et seul l'appelant
 * connaît le lien. Importer la simulation depuis ici rendrait le paquet
 * inutilisable dans tout projet qui n'a pas ce moteur, pour un onglet sur deux.
 */
export interface PersonaView {
  name: string;
  tribe: string;
  role: string;
  persona: string | null;
  /** Cinq besoins, échelle 0–100. */
  needs: Readonly<Record<NeedId, number>>;
  action: string | null;
  plan: readonly string[];
}

const BESOINS: readonly NeedId[] = ['hunger', 'warmth', 'energy', 'affection', 'stress'];

const LIBELLES: Readonly<Record<NeedId, string>> = {
  hunger: 'Faim', warmth: 'Chaleur', energy: 'Énergie',
  affection: 'Affection', stress: 'Stress',
};

export const NEED_ROW_IDS: Readonly<Record<NeedId, { label: string; bar: string; value: string }>> =
  Object.freeze(
    Object.fromEntries(
      BESOINS.map((b) => [b, {
        label: `need-label-${b}`, bar: `need-bar-${b}`, value: `need-val-${b}`,
      }]),
    ),
  ) as Readonly<Record<NeedId, { label: string; bar: string; value: string }>>;

/** Ce qu'un champ affiche quand il n'a rien à dire. */
const ABSENT = '—';

export const PERSONA_IDS = Object.freeze({
  role: 'persona-role',
  text: 'persona-text',
  action: 'persona-action',
  plan: 'persona-plan',
  absent: 'persona-absent',
});

export class PersonaTab {
  constructor(private readonly doc: PanelDocument) {
    for (const b of BESOINS) {
      setText(this.doc.getElementById(NEED_ROW_IDS[b].label), LIBELLES[b]);
    }
  }

  render(view: PersonaView | null): void {
    show(this.doc.getElementById(PERSONA_IDS.absent), view === null);
    if (view === null) {
      this.effacer();
      return;
    }

    setText(this.doc.getElementById(PERSONA_IDS.role), `${view.name} — ${view.role} (${view.tribe})`);
    setText(this.doc.getElementById(PERSONA_IDS.text), view.persona ?? '—');

    for (const b of BESOINS) {
      const valeur = view.needs[b];
      // Les besoins sont sur 0–100 ; la jauge prend une FRACTION. Passer 80
      // tel quel donnerait 8000 %, borné à 100 % — toutes les barres pleines,
      // et un panneau qui semble marcher.
      renderGauge(this.doc, NEED_ROW_IDS[b].bar, NEED_ROW_IDS[b].value, valeur / 100, String(Math.round(valeur)));
    }

    setText(this.doc.getElementById(PERSONA_IDS.action), view.action ?? 'au repos');
    setText(
      this.doc.getElementById(PERSONA_IDS.plan),
      view.plan.length === 0 ? 'aucun plan' : view.plan.join(' → '),
    );
  }

  /**
   * Vide la fiche. Le retour anticipé de `render(null)` affichait la note
   * d'absence PAR-DESSUS les données du dernier rendu réussi : nom, rôle,
   * tribu, les cinq besoins, l'action et le plan restaient à l'écran, du
   * villageois précédent, présentés comme s'ils étaient courants. Le
   * déclencheur est réel dans la démo — `index.ts` rend `null` quand
   * `agentIdParEntite` ou `runtime.agents` ne connaît pas encore l'entité.
   */
  private effacer(): void {
    setText(this.doc.getElementById(PERSONA_IDS.role), ABSENT);
    setText(this.doc.getElementById(PERSONA_IDS.text), ABSENT);
    for (const b of BESOINS) {
      renderGauge(this.doc, NEED_ROW_IDS[b].bar, NEED_ROW_IDS[b].value, 0, ABSENT);
    }
    setText(this.doc.getElementById(PERSONA_IDS.action), ABSENT);
    setText(this.doc.getElementById(PERSONA_IDS.plan), ABSENT);
  }
}
