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
 */
export const GENE_STEP: number =
  (CharacterStructure.schema.stature as { step?: number }).step ?? 0.01;

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

/** Étiquettes lisibles, dans l'ordre du panneau. */
const LIBELLES: Readonly<Record<string, string>> = {
  stature: 'Stature', armLength: 'Longueur de bras', legLength: 'Longueur de jambe',
  torsoLength: 'Longueur de tronc', shoulderWidth: "Largeur d'épaules",
  jawWidth: 'Mâchoire', noseSize: 'Nez', eyeScale: 'Yeux',
  cheekbone: 'Pommettes', bodyMass: 'Corpulence',
  skinTone: 'Teint', hairTone: 'Cheveux', hairStyle: 'Coiffure',
};

export class SettingsTab {
  /** Les gènes inertes au dernier `refresh()`, relus à chaque clic. */
  private inertes: ReadonlySet<string> = new Set();

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

  refresh(): void {
    this.inertes = this.hooks.inertGenes();
    for (const cle of Object.keys(GENE_ROW_IDS)) {
      const ids = GENE_ROW_IDS[cle]!;
      // Deux raisons distinctes de ne pas offrir de bouton, et la ligne le dit :
      // le rig ne porte pas la cible (inerte), ou aucun composant ne peut
      // recevoir la valeur (non éditable).
      const inerte = this.inertes.has(cle) || NON_EDITABLE_GENES.has(cle);
      const valeur = this.hooks.read(cle);
      renderGauge(this.doc, ids.bar, ids.value, valeur, valeur.toFixed(2));
      // Grisée, sans boutons, et avec sa raison : une ligne éteinte sans
      // explication est une panne muette.
      this.doc.getElementById(ids.row)?.setProperties({ opacity: inerte ? 0.4 : 1 });
      show(this.doc.getElementById(ids.minus), !inerte);
      show(this.doc.getElementById(ids.plus), !inerte);
      show(this.doc.getElementById(ids.note), inerte);
    }
  }

  private bump(cle: string, delta: number): void {
    // Cacher le bouton ne suffit pas : un rayon peut encore atteindre un
    // élément masqué selon l'implémentation, et le gestionnaire reste branché.
    // La garde est ici, pas dans l'affichage.
    if (this.inertes.has(cle) || NON_EDITABLE_GENES.has(cle)) return;
    const suivant = this.hooks.read(cle) + delta;
    this.hooks.write(cle, suivant < 0 ? 0 : suivant > 1 ? 1 : suivant);
    this.refresh();
  }
}
