import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RPMAnimationCatalog,
  AvatarAnimationController,
} from '../src/avatar';
import { EmotionType } from '../src/components/NPCEmotion';

describe('Ready Player Me Animation Library Integration', () => {
  describe('RPMAnimationCatalog', () => {
    it('should map idle clips by gender', () => {
      expect(RPMAnimationCatalog.getIdleClip('masculine')).toBe('M_Standing_Idle_001');
      expect(RPMAnimationCatalog.getIdleClip('feminine')).toBe('F_Standing_Idle_001');
    });

    it('should map talking variations', () => {
      expect(RPMAnimationCatalog.getTalkingClip(1, 'masculine')).toBe('M_Talking_Variations_001');
      expect(RPMAnimationCatalog.getTalkingClip(2, 'feminine')).toBe('F_Talking_Variations_002');
    });

    it('should map Cardinal EmotionType to RPM expressive animations', () => {
      expect(RPMAnimationCatalog.getClipForEmotion(EmotionType.HOSTILE, 'masculine')).toBe('M_Arguing_001');
      expect(RPMAnimationCatalog.getClipForEmotion(EmotionType.EXCITED, 'feminine')).toBe('F_Dances_001');
      expect(RPMAnimationCatalog.getClipForEmotion(EmotionType.FEARFUL, 'masculine')).toBe('M_Scared_001');
      expect(RPMAnimationCatalog.getClipForEmotion(EmotionType.SUSPICIOUS, 'feminine')).toBe('F_Disagreeing_001');
    });

    it('should map tool calling emote names to standard RPM clips', () => {
      expect(RPMAnimationCatalog.getClipForEmote('wave', 'masculine')).toBe('M_Greetings_001');
      expect(RPMAnimationCatalog.getClipForEmote('bow', 'feminine')).toBe('F_Bow_001');
      expect(RPMAnimationCatalog.getClipForEmote('shrug', 'masculine')).toBe('M_Explaining_001');
      expect(RPMAnimationCatalog.getClipForEmote('point', 'feminine')).toBe('F_Point_001');
    });
  });

  describe('AvatarAnimationController', () => {
    let mockRoot: any;
    let controller: AvatarAnimationController;

    beforeEach(() => {
      mockRoot = {
        name: 'RPM_Avatar_Root',
        mixer: {
          clipAction: vi.fn((clip: any) => ({
            play: vi.fn(),
            stop: vi.fn(),
            reset: vi.fn(),
            fadeIn: vi.fn(),
            fadeOut: vi.fn(),
            crossFadeTo: vi.fn(),
            setEffectiveWeight: vi.fn(),
            setEffectiveTimeScale: vi.fn(),
            clip,
          })),
          update: vi.fn(),
        },
      };
      controller = new AvatarAnimationController(mockRoot, { gender: 'masculine', defaultFadeDuration: 0.25 });
    });

    it('should register and smoothly play base animations', () => {
      const mockClip = { name: 'M_Standing_Idle_001' };
      controller.registerClip('M_Standing_Idle_001', mockClip);

      controller.playBase('M_Standing_Idle_001');
      expect(controller.getCurrentBaseName()).toBe('M_Standing_Idle_001');
    });

    it('should transition between Talking and Idle states with speech', () => {
      controller.setTalking(true, 1);
      expect(controller.isTalking()).toBe(true);
      expect(controller.getCurrentBaseName()).toBe('M_Talking_Variations_001');

      controller.setTalking(false);
      expect(controller.isTalking()).toBe(false);
      expect(controller.getCurrentBaseName()).toBe('M_Standing_Idle_001');
    });

    it('should play one-shot emote gestures', async () => {
      vi.useFakeTimers();
      const emotePromise = controller.playEmote('wave', 1000);

      vi.advanceTimersByTime(1000);
      await emotePromise;
      vi.useRealTimers();
    });

    it('should advance animation mixer in update loop', () => {
      controller.update(0.016);
      expect(mockRoot.mixer.update).toHaveBeenCalledWith(0.016);
    });
  });
});
