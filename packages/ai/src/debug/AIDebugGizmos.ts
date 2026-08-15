export interface GizmoColorConfig {
  interactionRangeColor?: number; // default: 0x3b82f6 (blue)
  audioRefRangeColor?: number;     // default: 0x10b981 (green)
  audioMaxRangeColor?: number;     // default: 0xef4444 (red)
}

/**
 * Creates and updates visual wireframe spheres in Three.js for VR debugging.
 */
export class AIDebugGizmos {
  /**
   * Format live telemetry string for an NPC entity.
   */
  public static formatTelemetry(params: {
    npcId: number;
    personalityId: number;
    emotionName: string;
    isThinking: boolean;
    isPlayingVoice: boolean;
    lastLatencyMs?: number;
    tokensGenerated?: number;
  }): string {
    const status = params.isThinking
      ? '🧠 Réflexion en cours...'
      : params.isPlayingVoice
        ? '🔊 Parle...'
        : '💤 En attente';

    return [
      `[NPC #${params.npcId}] Humeur: ${params.emotionName}`,
      `Statut: ${status}`,
      params.lastLatencyMs !== undefined ? `Latence: ${Math.round(params.lastLatencyMs)}ms` : null,
      params.tokensGenerated !== undefined ? `Tokens: ${params.tokensGenerated}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Helper generating lightweight wireframe mesh descriptor data for 3D renderers.
   */
  public static createGizmoDescriptor(radii: {
    interactionRadius?: number;
    refDistance?: number;
    maxDistance?: number;
  }) {
    return {
      interactionSphere: { radius: radii.interactionRadius ?? 3.0, color: 0x3b82f6 },
      audioRefSphere: { radius: radii.refDistance ?? 2.0, color: 0x10b981 },
      audioMaxSphere: { radius: radii.maxDistance ?? 25.0, color: 0xef4444 },
    };
  }
}
