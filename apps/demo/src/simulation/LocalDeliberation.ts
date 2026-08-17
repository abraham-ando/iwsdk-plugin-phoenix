/**
 * Activation de la délibération locale : charge un modèle sur WebGPU et le
 * branche comme second étage de `Mode2Client`.
 *
 * C'est ce que le panneau d'activation appellera. Rien ne se charge tant que
 * personne ne le demande : le runtime WebLLM pèse 5,8 Mo et les poids du
 * modèle plusieurs centaines.
 */
import {
  WebGPUInferenceAdapter,
  DEFAULT_LOCAL_MODEL,
  localModel,
} from '@iwsdk/plugin-cardinal-ai';
import type { Mode2Client } from './Mode2Client';

export interface LocalDeliberationProgress {
  readonly text: string;
  /** Dans [0, 1]. */
  readonly progress: number;
}

export interface LocalDeliberationHandle {
  readonly modelId: string;
  disable(): void;
}

/** Le navigateur sait-il faire du WebGPU ? La question précède tout le reste. */
export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Charge le modèle et branche l'étage local. Rend la main quand le modèle est
 * prêt — pas avant, pour que l'appelant n'annonce jamais une capacité qui
 * n'existe pas encore.
 */
export async function enableLocalDeliberation(
  client: Mode2Client,
  options: {
    modelId?: string;
    onProgress?: (p: LocalDeliberationProgress) => void;
  } = {}
): Promise<LocalDeliberationHandle> {
  if (!webgpuAvailable()) {
    throw new Error('WebGPU indisponible dans ce navigateur');
  }
  const modelId = options.modelId ?? DEFAULT_LOCAL_MODEL;
  const choix = localModel(modelId);
  if (choix === undefined) {
    throw new Error(`modèle inconnu du catalogue : ${modelId}`);
  }

  const adapter = new WebGPUInferenceAdapter({ modelId }, (p) =>
    options.onProgress?.({ text: p.text, progress: p.progress })
  );
  await adapter.init();
  client.useLocalInference(adapter);

  return {
    modelId,
    disable(): void {
      client.useLocalInference(null);
      adapter.dispose();
    },
  };
}
