import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WebGPUInferenceAdapter } from '../src/adapters/WebGPUInferenceAdapter';

/**
 * Un worker de théâtre : on lui dit quoi répondre au chargement du modèle,
 * et il le poste comme le vrai.
 */
function fakeWorker(reply: (post: (msg: unknown) => void) => void) {
  const worker = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onerror: null as ((e: { message: string }) => void) | null,
    postMessage(_msg: unknown) {
      queueMicrotask(() => reply((data) => worker.onmessage?.({ data })));
    },
    terminate() {},
  };
  return worker as unknown as Worker;
}

const config = { modelId: 'llama-3.2-1b-it-q4f16-MLC' } as never;

describe("l'adaptateur WebGPU ne promet que ce qu'il peut tenir", () => {
  it("NE SE DÉCLARE PAS PRÊT QUAND LE MOTEUR MANQUE", () => {
    // Le défaut corrigé : le worker fabriquait une phrase française quand
    // `@mlc-ai/web-llm` était absent — c'est-à-dire toujours, puisqu'il
    // n'était pas installé. L'adaptateur se croyait prêt, ne touchait jamais
    // le GPU, et la démo aurait proposé une délibération inexistante.
    const adapter = new WebGPUInferenceAdapter(config, undefined, () =>
      fakeWorker((post) => post({ type: 'ERROR', payload: { message: 'WebGPU indisponible' } }))
    );
    expect(adapter.isReady).toBe(false);
    return expect(adapter.init()).rejects.toThrow('WebGPU indisponible');
  });

  it("reste non prêt APRÈS l'échec, pour qu'on n'en fasse pas un étage", async () => {
    const adapter = new WebGPUInferenceAdapter(config, undefined, () =>
      fakeWorker((post) => post({ type: 'ERROR', payload: { message: 'pas de WebGPU' } }))
    );
    await adapter.init().catch(() => undefined);
    expect(adapter.isReady).toBe(false);
  });

  it('se déclare prêt quand le modèle a réellement chargé', async () => {
    const adapter = new WebGPUInferenceAdapter(config, undefined, () =>
      fakeWorker((post) => post({ type: 'MODEL_READY', payload: { modelId: 'x' } }))
    );
    await adapter.init();
    expect(adapter.isReady).toBe(true);
  });

  it('RAPPORTE LA PROGRESSION du téléchargement', async () => {
    // Près d'un gigaoctet : sans retour, l'utilisateur croit que rien ne se
    // passe et le panneau serait muet pendant des minutes.
    const vus: number[] = [];
    const adapter = new WebGPUInferenceAdapter(
      config,
      (p) => vus.push(p.progress),
      () =>
        fakeWorker((post) => {
          post({ type: 'MODEL_PROGRESS', payload: { text: 'téléchargement', progress: 0.5 } });
          post({ type: 'MODEL_READY', payload: { modelId: 'x' } });
        })
    );
    await adapter.init();
    expect(vus).toContain(0.5);
  });
});

describe('le worker ne fabrique aucune réponse', () => {
  const source = readFileSync(
    new URL('../src/workers/llm.worker.ts', import.meta.url),
    'utf8'
  );

  it("CHARGE LE VRAI MOTEUR, sans masquer l'import au bundler", () => {
    // L'import passait par `new Function('m', 'return import(m)')`, invisible
    // du bundler : il échouait donc toujours, en silence.
    expect(source).toContain("import('@mlc-ai/web-llm')");
    expect(source).not.toContain('new Function(');
  });

  it("NE CONTIENT AUCUN MOTEUR DE SUBSTITUTION", () => {
    // Une réponse fabriquée qui se fait passer pour une inférence est pire
    // qu'une panne : elle rend l'échec invisible. Ce test tombe si quelqu'un
    // en réintroduit un.
    expect(source).not.toMatch(/simulée|simulated|Cardinal AI - \$\{/i);
    expect(source).not.toContain('fallback engine');
  });
});
