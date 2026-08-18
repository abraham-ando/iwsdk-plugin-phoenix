import { HUMANOID } from '@iwsdk/cardinal-character';
import { CharacterStructure } from '@iwsdk/cardinal-character-three';
import { renderGauge } from '../gauge';
import { show, setText, type PanelDocument } from '../document';

/**
 * Le pas d'un clic, pris dans le SCHÉMA du composant et non recopié.
 *
 * L'inspecteur bureau et le panneau spatial doivent avancer du même pas ; la
 * seule façon de le garantir est de le lire au même endroit. `stature` sert de
 * représentant : `gene()` donne le même `step` aux treize.
 *
 * On LÈVE plutôt que de replier sur `?? 0.01` : un repli en dur rendrait
 * exactement la même valeur que le schéma d'aujourd'hui, donc la disparition
 * du champ ne se verrait nulle part — ni à l'écran, ni en test. C'est un garde
 * qui ne peut pas tomber, la famille de défaut que cette vague corrige.
 */
function pasDuSchema(): number {
  const pas = (CharacterStructure.schema.stature as { step?: number }).step;
  if (typeof pas !== 'number') {
    throw new Error(
      "@iwsdk/cardinal-character-ui : `CharacterStructure.schema.stature.step` a disparu. " +
        "Le panneau spatial et l'inspecteur ne peuvent plus avancer du même pas ; " +
        'corriger le schéma plutôt que de recopier une constante ici.',
    );
  }
  return pas;
}

export const GENE_STEP: number = pasDuSchema();

interface GeneRowIds {
  row: string;
  bar: string;
  value: string;
  minus: string;
  plus: string;
  label: string;
  note: string;
}

/** Les identifiants du document, dérivés des gènes de la famille. */
export const GENE_ROW_IDS: Readonly<Record<string, GeneRowIds>> = Object.freeze(
  Object.fromEntries(
    Object.keys(HUMANOID.genes).map((cle) => [
      cle,
      {
        row: `gene-row-${cle}`,
        bar: `gene-bar-${cle}`,
        value: `gene-val-${cle}`,
        minus: `gene-minus-${cle}`,
        plus: `gene-plus-${cle}`,
        label: `gene-label-${cle}`,
        note: `gene-note-${cle}`,
      },
    ]),
  ),
);

/**
 * Les gènes qu'aucun composant ne peut recevoir.
 *
 * `CharacterSurface` ne porte que `skin` et `hair`, deux `Types.Color` : ce
 * sont les couleurs RÉSOLUES, écrites par le système de compilation depuis le
 * génome. Les trois gènes du groupe `surface` n'ont donc aucun champ scalaire
 * où s'écrire — les éditer voudrait dire écrire le génome lui-même, qui vit
 * dans `CharacterCompileSystem.genomes` et n'a pas de mutateur public.
 *
 * Dérivée du descripteur, jamais écrite en dur : le jour où une famille change
 * de groupes, la liste suit.
 */
export const NON_EDITABLE_GENES: ReadonlySet<string> = new Set(
  Object.entries(HUMANOID.genes)
    .filter(([, def]) => def.group === 'surface')
    .map(([cle]) => cle),
);

export interface SettingsHooks {
  /** Valeur courante du gène, dans `[0,1]`. */
  read(gene: string): number;
  /** Écrit la valeur, déjà bornée. */
  write(gene: string, value: number): void;
  /**
   * Les gènes sans effet sur le rig courant, DÉRIVÉS de son `ImportReport` —
   * jamais d'une liste en dur. Le jour où un rig complet arrive, les lignes se
   * rallument sans une ligne de code de plus.
   */
  inertGenes(): ReadonlySet<string>;
}

/**
 * Les DEUX raisons d'éteindre une ligne, et leur texte — distinctes parce que
 * les causes le sont.
 *
 * `NOTE_INERTE` parle du rig CHARGÉ : le morph ou la surface manque à cet
 * avatar-là, et un autre rig rallumerait la ligne sans une ligne de code.
 * `NOTE_NON_EDITABLE` parle d'une raison STRUCTURELLE, qui ne dépend d'aucun
 * rig : les trois gènes de surface n'ont aucun champ scalaire où s'écrire.
 * Afficher « inerte sur ce rig » pour ceux-là, comme le document le faisait
 * pour ses treize lignes, désigne au joueur une cause fausse dans trois cas
 * sur treize. Le texte vient d'ICI et non du balisage : le code est le seul
 * endroit qui connaisse la raison.
 */
export const NOTE_INERTE = 'inerte sur ce rig';
export const NOTE_NON_EDITABLE = 'réglé par le génome';

/**
 * Ce qu'on affiche à la place d'un nombre pour un gène non éditable.
 *
 * `install.ts` route la lecture de ces trois gènes vers `CharacterFace`, qui ne
 * les porte pas : `getValue` rend `null` et le repli afficherait `0.50` pour
 * les trois, quel que soit le génome réel — un chiffre inventé présenté comme
 * une mesure. Un tiret dit la vérité : cette valeur n'est pas lisible d'ici.
 */
const VALEUR_INCONNUE = '—';

/** Étiquettes lisibles, dans l'ordre du panneau. */
const LIBELLES: Readonly<Record<string, string>> = {
  stature: 'Stature', armLength: 'Longueur de bras', legLength: 'Longueur de jambe',
  torsoLength: 'Longueur de tronc', shoulderWidth: "Largeur d'épaules",
  jawWidth: 'Mâchoire', noseSize: 'Nez', eyeScale: 'Yeux',
  cheekbone: 'Pommettes', bodyMass: 'Corpulence',
  skinTone: 'Teint', hairTone: 'Cheveux', hairStyle: 'Coiffure',
};

export class SettingsTab {
  /**
   * Ce que la dernière écriture a posé sur chaque ligne — la mémoire qui
   * permet de ne réécrire QUE ce qui change.
   *
   * `refresh()` réécrivait inconditionnellement cinq `setProperties` et un
   * `setText` par gène, treize fois, dix fois par seconde : 650 appels uikit
   * par seconde. Chacun alloue (`Component.setProperties` fabrique
   * `{...this.inputProperties, ...inputProperties}`, puis
   * `setLayersWithConditionals` un objet par section), invalide le layout, et
   * tourne sur le thread de rendu dans un budget de 11–14 ms. Le document
   * garde ce qu'on lui a écrit : comparer à cette mémoire est donc exact, y
   * compris après un passage par l'onglet Persona.
   *
   * Deux cartes de scalaires plutôt qu'une carte d'objets : un littéral par
   * gène et par tick serait précisément ce qu'on cherche à supprimer.
   */
  private readonly derniereValeur = new Map<string, number>();
  private readonly derniereEteinte = new Map<string, boolean>();

  constructor(
    private readonly doc: PanelDocument,
    private readonly hooks: SettingsHooks,
  ) {
    for (const cle of Object.keys(GENE_ROW_IDS)) {
      const ids = GENE_ROW_IDS[cle]!;
      setText(this.doc.getElementById(ids.label), LIBELLES[cle] ?? cle);
      this.doc
        .getElementById(ids.minus)
        ?.addEventListener?.('click', () => this.bump(cle, -GENE_STEP));
      this.doc
        .getElementById(ids.plus)
        ?.addEventListener?.('click', () => this.bump(cle, +GENE_STEP));
    }
  }

  /**
   * Réécrit les lignes dont l'état a changé, et elles seules.
   *
   * L'appelant ne doit l'invoquer que lorsque l'onglet est VISIBLE — un onglet
   * en `display: none` n'a rien à montrer, et le rafraîchir était la moitié du
   * coût. Voir `install.ts`.
   */
  refresh(): void {
    const inertes = this.hooks.inertGenes();
    for (const cle of Object.keys(GENE_ROW_IDS)) {
      const ids = GENE_ROW_IDS[cle]!;
      // Deux raisons distinctes de ne pas offrir de bouton, et la ligne dit
      // LAQUELLE : le rig ne porte pas la cible (inerte), ou aucun composant
      // ne peut recevoir la valeur (non éditable, indépendant du rig).
      const nonEditable = NON_EDITABLE_GENES.has(cle);
      const eteinte = inertes.has(cle) || nonEditable;
      // `NaN` et non `0.5` pour un gène illisible : `Object.is(NaN, NaN)` est
      // vrai, donc la mémoire de changement fonctionne, et rien n'invente un
      // nombre. La jauge, elle, reçoit 0 et le texte un tiret.
      const valeur = nonEditable ? Number.NaN : this.hooks.read(cle);

      if (
        this.derniereEteinte.get(cle) === eteinte &&
        Object.is(this.derniereValeur.get(cle), valeur)
      ) {
        continue;
      }
      this.derniereEteinte.set(cle, eteinte);
      this.derniereValeur.set(cle, valeur);

      renderGauge(
        this.doc,
        ids.bar,
        ids.value,
        nonEditable ? 0 : valeur,
        nonEditable ? VALEUR_INCONNUE : valeur.toFixed(2),
      );
      // Grisée, sans boutons, et avec sa raison : une ligne éteinte sans
      // explication est une panne muette.
      this.doc.getElementById(ids.row)?.setProperties({ opacity: eteinte ? 0.4 : 1 });
      show(this.doc.getElementById(ids.minus), !eteinte);
      show(this.doc.getElementById(ids.plus), !eteinte);
      show(this.doc.getElementById(ids.note), eteinte);
      setText(
        this.doc.getElementById(ids.note),
        nonEditable ? NOTE_NON_EDITABLE : NOTE_INERTE,
      );
    }
  }

  private bump(cle: string, delta: number): void {
    // Cacher le bouton ne suffit pas : un rayon peut encore atteindre un
    // élément masqué selon l'implémentation, et le gestionnaire reste branché.
    // La garde est ici, pas dans l'affichage — et elle relit la liste À
    // L'INSTANT DU CLIC plutôt que celle du dernier `refresh()`, qui ne tourne
    // plus quand l'onglet est caché.
    if (this.hooks.inertGenes().has(cle) || NON_EDITABLE_GENES.has(cle)) return;
    const suivant = this.hooks.read(cle) + delta;
    this.hooks.write(cle, suivant < 0 ? 0 : suivant > 1 ? 1 : suivant);
    this.refresh();
  }
}
