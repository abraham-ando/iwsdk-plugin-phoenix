/**
 * Sonde de contention GPU : combien une génération locale coûte-t-elle au
 * temps d'image ?
 *
 * La question décide si la délibération locale tient en session XR, où le
 * budget est de 11 à 14 ms. Elle ne se répond pas au raisonnement : le
 * modèle et le rendu se disputent le même GPU, et seul le chiffre tranche.
 *
 * Activée par `?probe-gpu=1`. Tout passe par la console, préfixé [MESURE],
 * pour être relu depuis `iwsdk browser logs --pattern MESURE`.
 */
import { enableLocalDeliberation, webgpuAvailable } from './LocalDeliberation';
import type { Mode2Client } from './Mode2Client';

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

  /** p50, p95, pire cas et nombre d'images, en millisecondes. */
  report(): { p50: number; p95: number; max: number; frames: number } {
    if (this.samples.length === 0) return { p50: 0, p95: 0, max: 0, frames: 0 };
    const tri = [...this.samples].sort((a, b) => a - b);
    const at = (q: number): number => tri[Math.min(tri.length - 1, Math.floor(tri.length * q))]!;
    return { p50: at(0.5), p95: at(0.95), max: tri[tri.length - 1]!, frames: tri.length };
  }
}

const ms = (v: number): string => v.toFixed(1).padStart(6);

function log(phase: string, r: { p50: number; p95: number; max: number; frames: number }): void {
  console.log(
    `[MESURE] ${phase.padEnd(22)} p50 ${ms(r.p50)} ms | p95 ${ms(r.p95)} ms | pire ${ms(r.max)} ms | ${r.frames} images`
  );
}

const wait = (secondes: number): Promise<void> =>
  new Promise((r) => setTimeout(r, secondes * 1000));

export async function runGpuContentionProbe(client: Mode2Client): Promise<void> {
  console.log(`[MESURE] WebGPU disponible : ${webgpuAvailable()}`);
  if (!webgpuAvailable()) return;

  const sampler = new FrameSampler();
  sampler.start();

  // 1. Référence : le rendu seul, sans rien d'autre.
  await wait(8);
  log('référence (rendu seul)', sampler.report());

  // 2. Le chargement du modèle. Des centaines de mégaoctets à télécharger puis
  //    à téléverser sur le GPU : c'est un coût distinct de la génération.
  sampler.reset();
  const t0 = performance.now();
  let dernier = -1;
  const handle = await enableLocalDeliberation(client, {
    onProgress: (p) => {
      const pct = Math.floor(p.progress * 10) * 10;
      if (pct !== dernier) {
        dernier = pct;
        console.log(`[MESURE] chargement ${String(pct).padStart(3)} % — ${p.text}`);
      }
    },
  }).catch((err: unknown) => {
    console.log(`[MESURE] chargement ÉCHOUÉ : ${String(err)}`);
    return null;
  });
  if (handle === null) {
    sampler.stop();
    return;
  }
  console.log(`[MESURE] modèle ${handle.modelId} prêt en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  log('pendant le chargement', sampler.report());

  // 3. Le rendu seul à nouveau, modèle en mémoire mais au repos : la VRAM
  //    occupée coûte-t-elle quelque chose par elle-même ?
  sampler.reset();
  await wait(8);
  log('modèle chargé, au repos', sampler.report());

  // 4. Pendant une génération. C'est le chiffre qui décide.
  sampler.reset();
  const g0 = performance.now();
  const resultat = await client
    .deliberateNow({
      requestId: 'sonde:0:dawn',
      reason: 'dawn',
      agentId: 'haran',
      tick: 0,
      hour: 6,
      persona: 'Protecteur pragmatique',
      role: 'Père & Éclaireur',
      tribe: 'Aube',
      needs: { hunger: 40, warmth: 55, energy: 70, affection: 60, stress: 10 },
      place: 'camp_aube',
      beliefs: [{ objectId: 'oak_tree_7', type: 'oak_tree', distance: 11.2, state: { woodLeft: 8 } }],
      memories: ['Le feu a manqué de bois hier soir.'],
      tools: [{ verb: 'gather_wood', objectId: 'oak_tree_7', type: 'oak_tree', distance: 11.2 }],
      currentPlan: [],
    })
    .catch((err: unknown) => {
      console.log(`[MESURE] génération ÉCHOUÉE : ${String(err)}`);
      return null;
    });
  const secondes = (performance.now() - g0) / 1000;
  log('PENDANT UNE GÉNÉRATION', sampler.report());
  console.log(`[MESURE] génération en ${secondes.toFixed(1)} s`);
  console.log(`[MESURE] étage : ${resultat?.tier ?? 'aucun'}`);
  console.log(`[MESURE] plan rendu : ${JSON.stringify(resultat?.payload ?? null).slice(0, 400)}`);

  sampler.stop();
}
