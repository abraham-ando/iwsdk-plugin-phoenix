/**
 * WebGPU Compute Web Worker for Universal Small & Large Language Model Inference.
 * Runs asynchronously off the main render thread to protect the 90 FPS WebXR VR budget.
 * Supports Gemma, Llama 3.2, Qwen 2.5, Phi-3.5, Mistral, SmolLM, etc.
 */

export {};

interface WebLLMEngine {
  chat: {
    completions: {
      create(opts: {
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
      }): Promise<{ choices: Array<{ message: { content: string } }> }>;
    };
  };
}

let engine: WebLLMEngine | null = null;
let currentModelId: string | null = null;
let isInitializing = false;

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'LOAD_MODEL': {
      const modelId = payload?.modelId ?? 'llama-3.2-1b-it-q4f16-MLC';
      if (engine && currentModelId === modelId) {
        self.postMessage({ type: 'MODEL_READY', payload: { modelId } });
        return;
      }
      if (isInitializing) return;
      isInitializing = true;

      try {
        self.postMessage({
          type: 'MODEL_PROGRESS',
          payload: { text: `Initializing WebGPU context for ${modelId}...`, progress: 0.05 },
        });

        // Import dynamique : WebLLM et son WASM ne se chargent qu'au moment
        // où quelqu'un demande un modèle, dans un morceau à part.
        //
        // Il n'y a plus de moteur de substitution. Il y en avait un, qui
        // rendait une phrase française fabriquée quand l'import échouait —
        // c'est-à-dire TOUJOURS, puisque `@mlc-ai/web-llm` n'était pas
        // installé. L'adaptateur se croyait prêt et ne touchait jamais le GPU.
        // Mieux vaut échouer et le dire : l'appelant n'offrira pas une
        // délibération qu'il ne peut pas tenir.
        const webllm = await import('@mlc-ai/web-llm');
        engine = (await webllm.CreateMLCEngine(modelId, {
          ...(payload?.appConfig ? { appConfig: payload.appConfig } : {}),
          initProgressCallback: (progress: { text: string; progress: number }) => {
            self.postMessage({
              type: 'MODEL_PROGRESS',
              payload: { text: progress.text, progress: progress.progress },
            });
          },
        })) as unknown as WebLLMEngine;

        currentModelId = modelId;
        isInitializing = false;
        self.postMessage({ type: 'MODEL_READY', payload: { modelId } });
      } catch (error: any) {
        isInitializing = false;
        self.postMessage({
          type: 'ERROR',
          payload: { message: error?.message || `Failed to load WebGPU model ${modelId}` },
        });
      }
      break;
    }

    case 'GENERATE_NPC_DECISION': {
      if (!engine) {
        self.postMessage({
          type: 'ERROR',
          payload: { message: 'LLM WebGPU Engine is not initialized', requestId: payload?.requestId },
        });
        return;
      }

      const startTime = performance.now();
      try {
        const { requestId, npcId, systemPrompt, worldContext, playerMessage, temperature, maxTokens } = payload;

        const messages = [
          {
            role: 'system',
            content: `${systemPrompt}${worldContext ? `\n[Contexte Monde]: ${worldContext}` : ''}`,
          },
          { role: 'user', content: playerMessage },
        ];

        const response = await engine.chat.completions.create({
          messages,
          temperature: temperature ?? 0.7,
          max_tokens: maxTokens ?? 128,
        });

        const replyText = response.choices[0]?.message?.content ?? '';
        const latencyMs = performance.now() - startTime;

        self.postMessage({
          type: 'NPC_DECISION_RESULT',
          payload: {
            requestId,
            npcId,
            text: replyText,
            latencyMs,
            tokensGenerated: Math.ceil(replyText.length / 4),
          },
        });
      } catch (error: any) {
        self.postMessage({
          type: 'ERROR',
          payload: {
            message: error?.message || 'Inference error',
            requestId: payload?.requestId,
          },
        });
      }
      break;
    }
  }
};
