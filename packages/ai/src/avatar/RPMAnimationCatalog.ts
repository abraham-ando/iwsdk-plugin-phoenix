/**
 * Ready Player Me Animation Library Catalog and Semantic Mappings.
 * References standard motion-captured animation clips from readyplayerme/animation-library.
 */

import { EmotionType } from '../components/NPCEmotion';

export type RPMGender = 'feminine' | 'masculine';

export interface RPMClipDefinition {
  id: string;
  name: string;
  category: 'locomotion' | 'expression' | 'talking' | 'emote' | 'reaction' | 'dance';
  urlPath?: string;
  isLoop: boolean;
}

export class RPMAnimationCatalog {
  /**
   * Core Standard RPM Animation Definitions
   */
  public static readonly CLIPS: Record<string, RPMClipDefinition> = {
    // Idle & Locomotion
    'idle_feminine': { id: 'idle_feminine', name: 'F_Standing_Idle_001', category: 'locomotion', isLoop: true },
    'idle_masculine': { id: 'idle_masculine', name: 'M_Standing_Idle_001', category: 'locomotion', isLoop: true },
    'walk_feminine': { id: 'walk_feminine', name: 'F_Walk_001', category: 'locomotion', isLoop: true },
    'walk_masculine': { id: 'walk_masculine', name: 'M_Walk_001', category: 'locomotion', isLoop: true },
    'run_feminine': { id: 'run_feminine', name: 'F_Run_001', category: 'locomotion', isLoop: true },
    'run_masculine': { id: 'run_masculine', name: 'M_Run_001', category: 'locomotion', isLoop: true },

    // Dialogue & Talking variations
    'talk_1_feminine': { id: 'talk_1_feminine', name: 'F_Talking_Variations_001', category: 'talking', isLoop: true },
    'talk_2_feminine': { id: 'talk_2_feminine', name: 'F_Talking_Variations_002', category: 'talking', isLoop: true },
    'talk_1_masculine': { id: 'talk_1_masculine', name: 'M_Talking_Variations_001', category: 'talking', isLoop: true },
    'talk_2_masculine': { id: 'talk_2_masculine', name: 'M_Talking_Variations_002', category: 'talking', isLoop: true },

    // Thinking & Gestures
    'thinking_feminine': { id: 'thinking_feminine', name: 'F_Thinking_001', category: 'expression', isLoop: true },
    'thinking_masculine': { id: 'thinking_masculine', name: 'M_Thinking_001', category: 'expression', isLoop: true },
    'agreeing_feminine': { id: 'agreeing_feminine', name: 'F_Agreeing_001', category: 'expression', isLoop: false },
    'agreeing_masculine': { id: 'agreeing_masculine', name: 'M_Agreeing_001', category: 'expression', isLoop: false },
    'disagreeing_feminine': { id: 'disagreeing_feminine', name: 'F_Disagreeing_001', category: 'expression', isLoop: false },
    'disagreeing_masculine': { id: 'disagreeing_masculine', name: 'M_Disagreeing_001', category: 'expression', isLoop: false },

    // Emotes & Social
    'greeting_feminine': { id: 'greeting_feminine', name: 'F_Greetings_001', category: 'emote', isLoop: false },
    'greeting_masculine': { id: 'greeting_masculine', name: 'M_Greetings_001', category: 'emote', isLoop: false },
    'shrug_feminine': { id: 'shrug_feminine', name: 'F_Explaining_001', category: 'emote', isLoop: false },
    'shrug_masculine': { id: 'shrug_masculine', name: 'M_Explaining_001', category: 'emote', isLoop: false },
    'cheer_feminine': { id: 'cheer_feminine', name: 'F_Dances_001', category: 'dance', isLoop: false },
    'cheer_masculine': { id: 'cheer_masculine', name: 'M_Dances_001', category: 'dance', isLoop: false },
    'bow_feminine': { id: 'bow_feminine', name: 'F_Bow_001', category: 'emote', isLoop: false },
    'bow_masculine': { id: 'bow_masculine', name: 'M_Bow_001', category: 'emote', isLoop: false },
    'point_feminine': { id: 'point_feminine', name: 'F_Point_001', category: 'emote', isLoop: false },
    'point_masculine': { id: 'point_masculine', name: 'M_Point_001', category: 'emote', isLoop: false },

    // Emotions & Reactions
    'angry_feminine': { id: 'angry_feminine', name: 'F_Arguing_001', category: 'expression', isLoop: false },
    'angry_masculine': { id: 'angry_masculine', name: 'M_Arguing_001', category: 'expression', isLoop: false },
    'scared_feminine': { id: 'scared_feminine', name: 'F_Scared_001', category: 'reaction', isLoop: false },
    'scared_masculine': { id: 'scared_masculine', name: 'M_Scared_001', category: 'reaction', isLoop: false },
  };

  /**
   * Get standard Idle animation clip name
   */
  public static getIdleClip(gender: RPMGender = 'masculine'): string {
    return gender === 'feminine' ? 'F_Standing_Idle_001' : 'M_Standing_Idle_001';
  }

  /**
   * Get Talking animation clip name
   */
  public static getTalkingClip(variation = 1, gender: RPMGender = 'masculine'): string {
    const v = String(Math.max(1, Math.min(2, variation))).padStart(3, '0');
    return gender === 'feminine' ? `F_Talking_Variations_${v}` : `M_Talking_Variations_${v}`;
  }

  /**
   * Map Cardinal EmotionType to RPM animation clip
   */
  public static getClipForEmotion(emotion: number, gender: RPMGender = 'masculine'): string {
    const isFem = gender === 'feminine';
    switch (emotion) {
      case EmotionType.HOSTILE:
        return isFem ? 'F_Arguing_001' : 'M_Arguing_001';
      case EmotionType.FEARFUL:
        return isFem ? 'F_Scared_001' : 'M_Scared_001';
      case EmotionType.EXCITED:
        return isFem ? 'F_Dances_001' : 'M_Dances_001';
      case EmotionType.SUSPICIOUS:
        return isFem ? 'F_Disagreeing_001' : 'M_Disagreeing_001';
      case EmotionType.FRIENDLY:
        return isFem ? 'F_Greetings_001' : 'M_Greetings_001';
      case EmotionType.NEUTRAL:
      default:
        return this.getIdleClip(gender);
    }
  }

  /**
   * Map tool call emote name (e.g. 'wave', 'bow', 'point', 'shrug') to RPM animation clip
   */
  public static getClipForEmote(emoteName: string, gender: RPMGender = 'masculine'): string {
    const normalized = (emoteName || '').toLowerCase().trim();
    const isFem = gender === 'feminine';

    switch (normalized) {
      case 'wave':
      case 'greeting':
      case 'hello':
        return isFem ? 'F_Greetings_001' : 'M_Greetings_001';
      case 'bow':
        return isFem ? 'F_Bow_001' : 'M_Bow_001';
      case 'point':
        return isFem ? 'F_Point_001' : 'M_Point_001';
      case 'shrug':
      case 'explain':
        return isFem ? 'F_Explaining_001' : 'M_Explaining_001';
      case 'think':
      case 'thinking':
        return isFem ? 'F_Thinking_001' : 'M_Thinking_001';
      case 'agree':
      case 'nod':
        return isFem ? 'F_Agreeing_001' : 'M_Agreeing_001';
      case 'disagree':
      case 'shakehead':
        return isFem ? 'F_Disagreeing_001' : 'M_Disagreeing_001';
      case 'cheer':
      case 'dance':
        return isFem ? 'F_Dances_001' : 'M_Dances_001';
      case 'angry':
      case 'argue':
        return isFem ? 'F_Arguing_001' : 'M_Arguing_001';
      case 'scared':
        return isFem ? 'F_Scared_001' : 'M_Scared_001';
      default:
        return this.getIdleClip(gender);
    }
  }
}
