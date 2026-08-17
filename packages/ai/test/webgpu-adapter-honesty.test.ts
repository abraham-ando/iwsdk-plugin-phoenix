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

describe('le modèle par défaut existe pour de bon', () => {
  it("EST CONNU DE WEBLLM, et pas seulement plausible", async () => {
    // `llama-3.2-1b-it-q4f16-MLC` a figuré des mois comme défaut et dans la
    // documentation. Il n'existe pas : le vrai s'appelle
    // `Llama-3.2-1B-Instruct-q4f16_1-MLC`. Personne ne l'a vu, parce que le
    // chemin local ne tournait jamais. Ce test relie enfin la constante à la
    // liste qui fait autorité.
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const connus = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id));

    const worker = readFileSync(new URL('../src/workers/llm.worker.ts', import.meta.url), 'utf8');
    const plugin = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
    const defauts = [worker, plugin].map((src) => {
      const found = src.match(/'([A-Za-z0-9._-]*-MLC)'/);
      return found?.[1];
    });

    for (const id of defauts) {
      expect(id, 'aucun identifiant de modèle trouvé').toBeTruthy();
      expect(connus.has(id!), `${id} est inconnu de WebLLM`).toBe(true);
    }
    // Les deux défauts doivent s'accorder, sinon le worker charge autre chose
    // que ce que le plugin annonce.
    expect(new Set(defauts).size).toBe(1);
  });
});
