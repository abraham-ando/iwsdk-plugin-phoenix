import type { Entity } from '@iwsdk/core';
import { NPCEmotion, EmotionType, EmotionPromptModifiers, EmotionTypeValue } from '../components/NPCEmotion';
import { getDialogueHistory } from '../components/NPCMemory';

export interface WeatherData {
  kind: number; // 0: clear, 1: rain, 2: storm, 3: fog
  intensity?: number;
  wind?: [number, number, number];
}

export interface CardinalWorldContextOptions {
  /** Weather state */
  weather?: WeatherData;
  /** Server monotonic or world time in ms */
  worldTimeMs?: number;
  /** Length of a full day cycle in ms (default: 1200000 = 20 mins) */
  dayLengthMs?: number;
  /** Named region / sector identifier */
  sectorName?: string;
  /** Additional custom situational details */
  customContext?: string;
}

export const WeatherKindNames: Record<number, string> = {
  0: 'Ciel dégagé et clair',
  1: 'Pluie battante',
  2: 'Orage violent avec éclairs',
  3: 'Brume épaisse',
};

/**
 * Builds rich structured world prompts for the LLM from Cardinal ECS component states.
 */
export class CardinalContextBuilder {
  /**
   * Derive daylight phase from world monotonic time.
   */
  public static getDayPhase(worldTimeMs = 0, dayLengthMs = 1200000): { phase: string; timeString: string } {
    const cyclePos = (worldTimeMs % dayLengthMs) / dayLengthMs; // [0, 1)
    const hours = Math.floor(cyclePos * 24);
    const minutes = Math.floor((cyclePos * 24 - hours) * 60);
    const timeString = `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}`;

    let phase = 'Plein jour';
    if (cyclePos < 0.2) phase = 'Aube naissante';
    else if (cyclePos < 0.7) phase = 'Plein jour';
    else if (cyclePos < 0.8) phase = 'Crépuscule';
    else phase = 'Nuit noire';

    return { phase, timeString };
  }

  /**
   * Construct context description string from world environment and entity states.
   */
  public static buildContext(
    entity?: Entity | null,
    options: CardinalWorldContextOptions = {}
  ): string {
    const lines: string[] = [];

    // 1. Sector / Location
    if (options.sectorName) {
      lines.push(`- Lieu : ${options.sectorName}`);
    }

    // 2. Day/Night & World Clock
    const { phase, timeString } = this.getDayPhase(options.worldTimeMs, options.dayLengthMs);
    lines.push(`- Heure : ${timeString} (${phase})`);

    // 3. Weather
    if (options.weather !== undefined) {
      const weatherName = WeatherKindNames[options.weather.kind] ?? 'Variable';
      const intensityPct = Math.round((options.weather.intensity ?? 0.5) * 100);
      lines.push(`- Climat : ${weatherName} (intensité : ${intensityPct}%)`);
    }

    // 4. Entity Emotion
    if (entity && (NPCEmotion as any).bit && entity.hasComponent(NPCEmotion)) {
      const emotionVal = (entity.getValue(NPCEmotion, 'currentEmotion') ?? 0) as EmotionTypeValue;
      const modifier = EmotionPromptModifiers[emotionVal] ?? '';
      lines.push(`- Ton état d'esprit actuel : ${modifier}`);
    }

    // 5. Conversational Memory Summary
    if (entity) {
      const entityId = (entity as any).id ?? 0;
      const history = getDialogueHistory(entityId);
      if (history.length > 0) {
        lines.push('- Historique récent de conversation :');
        for (const turn of history.slice(-4)) {
          const speaker = turn.role === 'user' ? 'Joueur' : 'Toi (PNJ)';
          lines.push(`  * ${speaker} : "${turn.content}"`);
        }
      }
    }

    // 6. Custom Application Context
    if (options.customContext) {
      lines.push(`- Détails : ${options.customContext}`);
    }

    return lines.join('\n');
  }
}
