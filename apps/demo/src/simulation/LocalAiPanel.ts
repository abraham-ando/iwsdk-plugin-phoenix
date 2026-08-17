/**
 * Pilote le panneau d'activation de la délibération locale.
 *
 * Le document UIKitML ne porte aucun chiffre : libellés, VRAM et mises en
 * garde viennent du catalogue de `@iwsdk/plugin-cardinal-ai`, dont un test
 * confronte chaque entrée à ce que WebLLM annonce. Recopier ces valeurs dans
 * le balisage les ferait diverger en silence.
 *
 * L'avertissement XR n'est pas décoratif : sur ordinateur le coût GPU d'une
 * génération est mesuré et négligeable (p95 9,4 ms contre 10,1 au repos), sur
 * casque il ne l'est pas — rendu stéréo, GPU plus faible, mémoire partagée.
 * Tant que la mesure manque, le panneau le dit.
 */
import { LOCAL_MODELS, type LocalModelChoice } from '@iwsdk/plugin-cardinal-ai';
import { enableLocalDeliberation, webgpuAvailable, type LocalDeliberationHandle } from './LocalDeliberation';
import type { Mode2Client } from './Mode2Client';

/** Ce que le panneau sait faire d'un élément, sans dépendre de Three. */
export interface PanelElement {
  setProperties(props: Record<string, unknown>): void;
  setText?(text: string): void;
  addEventListener?(type: string, handler: () => void): void;
}

export interface PanelDocument {
  getElementById(id: string): PanelElement | null | undefined;
}

/** Nombre d'emplacements que le document réserve aux modèles. */
export const MODEL_SLOTS = 3;

const show = (el: PanelElement | null | undefined, visible: boolean): void => {
  el?.setProperties({ display: visible ? 'flex' : 'none' });
};

const setText = (el: PanelElement | null | undefined, text: string): void => {
  if (el === null || el === undefined) return;
  if (typeof el.setText === 'function') el.setText(text);
  else el.setProperties({ text });
};

export class LocalAiPanel {
  private handle: LocalDeliberationHandle | null = null;
  private busy = false;

  constructor(
    private panel: PanelDocument,
    private client: Mode2Client,
    /** Vrai quand une session immersive est en cours. */
    private inXR: () => boolean
  ) {
    this.mountModels();
    this.refresh();
  }

  /** Remplit les emplacements depuis le catalogue, et masque les surnuméraires. */
  private mountModels(): void {
    for (let i = 0; i < MODEL_SLOTS; i++) {
      const choix: LocalModelChoice | undefined = LOCAL_MODELS[i];
      const bouton = this.panel.getElementById(`model-button-${i}`);
      if (choix === undefined) {
        show(this.panel.getElementById(`model-label-${i}`), false);
        show(this.panel.getElementById(`model-note-${i}`), false);
        show(bouton, false);
        continue;
      }
      setText(
        this.panel.getElementById(`model-label-${i}`),
        `${choix.label} — ${choix.vramMB} Mo de VRAM`
      );
      setText(this.panel.getElementById(`model-note-${i}`), choix.note);
      setText(this.panel.getElementById(`model-button-label-${i}`), `Activer ${choix.label}`);
      bouton?.addEventListener?.('click', () => void this.activate(choix));
    }
    if (LOCAL_MODELS.length > MODEL_SLOTS) {
      console.warn(
        `[LocalAiPanel] le catalogue porte ${LOCAL_MODELS.length} modèles pour ${MODEL_SLOTS} emplacements : ` +
          `${LOCAL_MODELS.slice(MODEL_SLOTS).map((m) => m.id).join(', ')} ne sont pas proposés.`
      );
    }
    this.panel
      .getElementById('disable-button')
      ?.addEventListener?.('click', () => this.deactivate());
  }

  /** Recalcule ce que le panneau montre, sans rien supposer d'un état passé. */
  refresh(): void {
    show(this.panel.getElementById('xr-warning'), this.inXR() && this.handle === null);

    const actif = this.handle !== null;
    for (let i = 0; i < MODEL_SLOTS; i++) {
      show(this.panel.getElementById(`model-button-${i}`), !actif && i < LOCAL_MODELS.length);
    }
    show(this.panel.getElementById('disable-button'), actif);

    if (!webgpuAvailable()) {
      setText(
        this.panel.getElementById('status'),
        "WebGPU n'est pas disponible ici : la délibération locale ne peut pas s'activer."
      );
      for (let i = 0; i < MODEL_SLOTS; i++) show(this.panel.getElementById(`model-button-${i}`), false);
      return;
    }
    if (this.busy) return;
    setText(
      this.panel.getElementById('status'),
      actif ? `Actif — ${this.handle!.modelId}` : 'Aucun moteur local actif.'
    );
  }

  private async activate(choix: LocalModelChoice): Promise<void> {
    if (this.busy || this.handle !== null) return;
    this.busy = true;
    for (let i = 0; i < MODEL_SLOTS; i++) show(this.panel.getElementById(`model-button-${i}`), false);
    setText(this.panel.getElementById('status'), `${choix.label} : préparation…`);

    try {
      this.handle = await enableLocalDeliberation(this.client, {
        modelId: choix.id,
        onProgress: (p) => {
          const pct = Math.round(p.progress * 100);
          setText(
            this.panel.getElementById('status'),
            `${choix.label} : ${pct} % — ${p.text.slice(0, 60)}`
          );
        },
      });
    } catch (err) {
      // Un échec doit se voir. Le plus courant est mémorable : gemma3-1b se
      // télécharge entièrement puis refuse de s'initialiser.
      setText(
        this.panel.getElementById('status'),
        `${choix.label} n'a pas pu démarrer : ${String(err).slice(0, 120)}`
      );
      console.warn('[LocalAiPanel] activation impossible', err);
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private deactivate(): void {
    this.handle?.disable();
    this.handle = null;
    this.refresh();
  }

  dispose(): void {
    this.deactivate();
  }
}
