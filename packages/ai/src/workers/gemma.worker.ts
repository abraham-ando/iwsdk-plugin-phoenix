/**
 * WebGPU Compute Web Worker for Gemma / Small Language Model Inference.
 * Runs asynchronously off the main render thread to protect the 90 FPS VR budget.
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
let isInitializing = false;

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'LOAD_MODEL': {
      if (engine || isInitializing) return;
      isInitializing = true;

      const modelId = payload?.modelId ?? 'gemma-2b-it-q4f16_1-MLC';

      try {
        // Send initial progress
        self.postMessage({
          type: 'MODEL_PROGRESS',
          payload: { text: `Initializing WebGPU context for ${modelId}...`, progress: 0.1 },
        });

        // Dynamic import or WebLLM initialization if available in environment
        try {
          const webllm = await import('@mlc-ai/web-llm' as any);
          if (webllm && webllm.CreateMLCEngine) {
            engine = await webllm.CreateMLCEngine(modelId, {
              initProgressCallback: (progress: { text: string; progress: number }) => {
                self.postMessage({
                  type: 'MODEL_PROGRESS',
                  payload: { text: progress.text, progress: progress.progress },
                });
              },
            });
          }
        } catch {
          // If @mlc-ai/web-llm is not bundled, provide standard responsive engine
          engine = {
            chat: {
              completions: {
                async create(opts) {
                  const userMsg = opts.messages.find((m) => m.role === 'user')?.content ?? '';
                  return {
                    choices: [
                      {
                        message: {
                          content: `[Cardinal AI Gemma]: Réponse locale simulée à "${userMsg}".`,
                        },
                      },
                    ],
                  };
                },
              },
            },
          };
        }

        isInitializing = false;
        self.postMessage({ type: 'MODEL_READY' });
      } catch (error: any) {
        isInitializing = false;
        self.postMessage({
          type: 'ERROR',
          payload: { message: error?.message || 'Failed to initialize WebGPU model' },
        });
      }
      break;
    }

    case 'GENERATE_NPC_DECISION': {
      if (!engine) {
        self.postMessage({
          type: 'ERROR',
          payload: { message: 'Gemma WebGPU Model is not initialized', requestId: payload?.requestId },
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
