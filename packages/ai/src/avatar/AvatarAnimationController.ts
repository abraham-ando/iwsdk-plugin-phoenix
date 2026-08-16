/**
 * Ready Player Me / glTF Avatar Animation Controller.
 * Manages Three.js AnimationMixer states, smooth cross-fades between base locomotion,
 * talking loops, and one-shot expressive emotes.
 */

import { RPMAnimationCatalog, type RPMGender } from './RPMAnimationCatalog';
import type { EmotionTypeValue } from '../components/NPCEmotion';

export interface AvatarAnimationControllerOptions {
  gender?: RPMGender;
  defaultFadeDuration?: number;
}

export class AvatarAnimationController {
  private mixer: any | null = null;
  private clips = new Map<string, any>();
  private actions = new Map<string, any>();
  private currentBaseAction: any | null = null;
  private currentEmoteAction: any | null = null;
  private currentBaseName: string = '';
  private gender: RPMGender = 'masculine';
  private defaultFadeDuration: number = 0.3;
  private isTalkingState: boolean = false;

  constructor(rootObject: any, options: AvatarAnimationControllerOptions = {}) {
    this.gender = options.gender ?? 'masculine';
    this.defaultFadeDuration = options.defaultFadeDuration ?? 0.3;

    if (rootObject) {
      // Lazy init or Three.js AnimationMixer duck-typing
      if (typeof (rootObject as any).mixer !== 'undefined') {
        this.mixer = (rootObject as any).mixer;
      } else if (typeof (globalThis as any).THREE?.AnimationMixer !== 'undefined') {
        this.mixer = new (globalThis as any).THREE.AnimationMixer(rootObject);
      } else {
        // Lightweight mock mixer for headless/test environments
        this.mixer = this.createMockMixer(rootObject);
      }
    }
  }

  /**
   * Register an AnimationClip with a friendly or RPM name.
   */
  public registerClip(name: string, clip: any): void {
    this.clips.set(name, clip);
    if (this.mixer && typeof this.mixer.clipAction === 'function') {
      const action = this.mixer.clipAction(clip);
      this.actions.set(name, action);
    }
  }

  /**
   * Smoothly cross-fade to a base loop animation (Idle, Talking, Walk, etc.).
   */
  public playBase(clipName: string, fadeDuration = this.defaultFadeDuration): void {
    if (this.currentBaseName === clipName) return;

    let nextAction = this.actions.get(clipName);
    if (!nextAction && this.mixer && typeof this.mixer.clipAction === 'function') {
      const clip = this.clips.get(clipName);
      if (clip) {
        nextAction = this.mixer.clipAction(clip);
        this.actions.set(clipName, nextAction);
      }
    }

    if (nextAction) {
      nextAction.reset();
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);

      if (this.currentBaseAction && this.currentBaseAction !== nextAction) {
        this.currentBaseAction.crossFadeTo(nextAction, fadeDuration, true);
      }
      nextAction.play();
      this.currentBaseAction = nextAction;
    }

    this.currentBaseName = clipName;
  }

  /**
   * Synchronize Talking state with speech synthesis.
   */
  public setTalking(isTalking: boolean, variation = 1): void {
    if (this.isTalkingState === isTalking) return;
    this.isTalkingState = isTalking;

    if (isTalking) {
      const talkClip = RPMAnimationCatalog.getTalkingClip(variation, this.gender);
      this.playBase(talkClip);
    } else {
      const idleClip = RPMAnimationCatalog.getIdleClip(this.gender);
      this.playBase(idleClip);
    }
  }

  /**
   * Play a one-shot expressive emote gesture (e.g. Wave, Bow, Shrug).
   */
  public async playEmote(emoteName: string, durationMs = 2500): Promise<void> {
    const clipName = RPMAnimationCatalog.getClipForEmote(emoteName, this.gender);
    const action = this.actions.get(clipName) || (this.mixer?.clipAction ? this.mixer.clipAction(this.clips.get(clipName)) : null);

    if (action) {
      action.reset();
      action.setEffectiveWeight(1);
      action.play();
      this.currentEmoteAction = action;
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.currentEmoteAction === action && action) {
          action.fadeOut(this.defaultFadeDuration);
          this.currentEmoteAction = null;
        }
        resolve();
      }, durationMs);
    });
  }

  /**
   * React to an NPC emotional shift.
   */
  public setEmotion(emotion: EmotionTypeValue | number): void {
    const clipName = RPMAnimationCatalog.getClipForEmotion(emotion, this.gender);
    this.playBase(clipName);
  }

  /**
   * Step the AnimationMixer in the game loop.
   */
  public update(deltaSeconds: number): void {
    if (this.mixer && typeof this.mixer.update === 'function') {
      this.mixer.update(deltaSeconds);
    }
  }

  public getCurrentBaseName(): string {
    return this.currentBaseName;
  }

  public isTalking(): boolean {
    return this.isTalkingState;
  }

  private createMockMixer(_root: any): any {
    return {
      clipAction: (clip: any) => ({
        play: () => {},
        stop: () => {},
        reset: () => {},
        fadeIn: () => {},
        fadeOut: () => {},
        crossFadeTo: (_to: any, _dur: number, _warp: boolean) => {},
        setEffectiveWeight: (_w: number) => {},
        setEffectiveTimeScale: (_s: number) => {},
        clip,
      }),
      update: (_dt: number) => {},
    };
  }
}
