/**
 * Sonde de budget de frame : combien coûte une frame de scène complète, en
 * continu, et — si l'instrumentation bonus s'y prête — combien y coûtent le
 * terrain, la flore et l'IA ?
 *
 * Contrairement à GpuContentionProbe.ts (une génération locale ponctuelle),
 * cette sonde n'a pas de scénario en phases : elle tourne pour la durée de
 * vie de la page, tant que quelqu'un veut savoir si le budget de 11,1 ms
 * (voir `.claude/skills/cardinal-ai-domain`) tient en pratique.
 *
 * Activée par `?probe-frame=1`. Tout passe par la console, préfixé [MESURE],
 * pour être relu depuis `iwsdk browser logs --pattern MESURE`.
 */
import { percentiles } from './FramePercentiles';

/** Fenêtre d'échantillonnage entre deux lignes [MESURE], en secondes. */
const FENETRE_S = 10;

/** Échantillonne les intervalles entre images, en continu. */
class FrameSampler {
  private samples: number[] = [];
  private last = 0;
  private running = false;

  start(): void {
    this.running = true;
    this.last = performance.now();
    const tick = (): void => {
      if (!this.running) return;
      const now = performance.now();
      this.samples.push(now - this.last);
      this.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.samples.length = 0;
  }

  report(): { p50: number; p95: number; p99: number } {
    return percentiles(this.samples);
  }
}

const ms = (v: number): string => v.toFixed(2);

function logFrame(r: { p50: number; p95: number; p99: number }): void {
  // Format exact attendu par le Gherkin de TS-B1 : ne pas y toucher sans
  // relire `backlog/technical-story/TS-B1.sonde-mesure-budget-frame.bdd.md`.
  console.log(`[MESURE] frame p50=${ms(r.p50)}ms p95=${ms(r.p95)}ms p99=${ms(r.p99)}ms`);
}

function logSysteme(nom: string, r: { p50: number; p95: number; p99: number }): void {
  console.log(`[MESURE] système:${nom} p50=${ms(r.p50)}ms p95=${ms(r.p95)}ms p99=${ms(r.p99)}ms`);
}

const wait = (secondes: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, secondes * 1000));

type UpdateFn = (...args: unknown[]) => unknown;
type SystemCtor = { prototype: Record<string, unknown> & { update?: UpdateFn } };

/**
 * Bonus (PAS un critère d'acceptation Gherkin) : mesure le coût par frame
 * des systèmes les plus suspects en enveloppant leur `update` sur le
 * PROTOTYPE, avant qu'aucune instance ne tourne.
 *
 * Chaque import dynamique est protégé individuellement : si un paquet ne
 * s'exporte pas comme prévu (renommage, refactor…), cette instrumentation ne
 * doit JAMAIS faire échouer la mesure de frame elle-même, qui reste le seul
 * critère non négociable de TS-B1.
 */
async function wrapSystemUpdates(): Promise<Map<string, number[]>> {
  const samplesParSysteme = new Map<string, number[]>();

  const wrap = (ctor: unknown, nom: string): void => {
    const proto = (ctor as Partial<SystemCtor> | undefined)?.prototype;
    if (!proto) return;
    const original = proto.update;
    if (typeof original !== 'function') return;
    // Garde-fou : n'enveloppe jamais deux fois le même prototype (par
    // exemple si la sonde était démarrée plusieurs fois par erreur).
    const flag = `__mesureBudgetFrameWrapped`;
    if (proto[flag] === true) return;
    proto[flag] = true;

    const echantillons: number[] = [];
    samplesParSysteme.set(nom, echantillons);
    proto.update = function patchedUpdate(this: unknown, ...args: unknown[]): unknown {
      const t0 = performance.now();
      const resultat = original.apply(this, args);
      echantillons.push(performance.now() - t0);
      return resultat;
    };
  };

  try {
    const world = (await import('@iwsdk/cardinal-world')) as {
      TerrainStreamingSystem?: unknown;
      FloraSystem?: unknown;
    };
    wrap(world.TerrainStreamingSystem, 'terrain');
    wrap(world.FloraSystem, 'flore');
  } catch (err) {
    console.log(`[MESURE] instrumentation terrain/flore indisponible : ${String(err)}`);
  }

  try {
    const ai = (await import('@iwsdk/plugin-cardinal-ai')) as {
      CardinalIntelligenceSystem?: unknown;
    };
    wrap(ai.CardinalIntelligenceSystem, 'ia');
  } catch (err) {
    console.log(`[MESURE] instrumentation IA indisponible : ${String(err)}`);
  }

  return samplesParSysteme;
}

/**
 * Démarre la sonde de budget de frame. Ne résout jamais tant que la page
 * vit : elle réémet une ligne [MESURE] toutes les FENETRE_S secondes.
 * Appelée uniquement derrière `?probe-frame=1` (voir index.ts) — sans ce
 * paramètre, ce module n'est même pas importé.
 */
export async function runFrameBudgetProbe(): Promise<void> {
  const sampler = new FrameSampler();
  sampler.start();

  let samplesParSysteme: Map<string, number[]>;
  try {
    samplesParSysteme = await wrapSystemUpdates();
  } catch (err) {
    // wrapSystemUpdates() capture déjà ses propres erreurs par import ;
    // ceci est une deuxième ceinture pour que rien, même une erreur
    // inattendue ici, n'empêche la mesure de frame de démarrer.
    console.log(`[MESURE] instrumentation systèmes indisponible : ${String(err)}`);
    samplesParSysteme = new Map();
  }

  // Échantillonnage en continu : une ligne [MESURE] toutes les FENETRE_S
  // secondes, indéfiniment — la sonde ne se termine que si la page se
  // ferme, jamais d'elle-même.
  for (;;) {
    await wait(FENETRE_S);
    logFrame(sampler.report());
    sampler.reset();

    for (const [nom, echantillons] of samplesParSysteme) {
      if (echantillons.length === 0) continue;
      logSysteme(nom, percentiles(echantillons));
      echantillons.length = 0;
    }
  }
}
