import { Types, createSystem, type Entity } from '@iwsdk/core';
import { SmartNPC } from '../components/SmartNPC';
import { NPCBanter } from '../components/NPCBanter';

export interface GroupTurn {
  speakerEntityIndex: number;
  text: string;
  timestamp: number;
}

export interface ConversationCircle {
  id: string;
  participantIndices: number[];
  activeSpeakerIndex: number | null;
  topic: string;
  turns: GroupTurn[];
  turnQueue: number[];
  cooldownUntil: number;
}

export class GroupConversationSystem extends createSystem(
  {
    participants: { required: [SmartNPC, NPCBanter] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    speechGapMs: { type: Types.Float32, default: 1500 },
  },
) {
  private circles = new Map<string, ConversationCircle>();
  private circleCounter = 0;

  public override update(): void {
    if (!this.config.enabled.value) return;

    // Periodic circle turn checks
    const now = Date.now();
    for (const [, circle] of this.circles) {
      if (circle.activeSpeakerIndex === null && circle.turnQueue.length > 0 && now >= circle.cooldownUntil) {
        circle.activeSpeakerIndex = circle.turnQueue.shift()!;
        circle.cooldownUntil = now + this.config.speechGapMs.value;
      }
    }
  }

  /**
   * Create a new conversation circle with a list of participating NPCs.
   */
  public createCircle(participants: Entity[], initialTopic: string): string {
    const id = `circle_${++this.circleCounter}`;
    const participantIndices = participants.map((p) => p.index);

    const firstSpeaker = participantIndices[0] ?? null;
    const remainingSpeakers = participantIndices.slice(1);

    const circle: ConversationCircle = {
      id,
      participantIndices,
      activeSpeakerIndex: firstSpeaker,
      topic: initialTopic,
      turns: [],
      turnQueue: remainingSpeakers,
      cooldownUntil: 0,
    };

    this.circles.set(id, circle);

    // Update Banter components
    for (const p of participants) {
      if (p.hasComponent(NPCBanter)) {
        p.setValue(NPCBanter, 'isBantering', true);
      }
    }

    return id;
  }

  /**
   * Request a turn to speak for an NPC inside a conversation circle.
   */
  public requestTurn(circleId: string, npc: Entity): boolean {
    const circle = this.circles.get(circleId);
    if (!circle || !circle.participantIndices.includes(npc.index)) return false;

    if (!circle.turnQueue.includes(npc.index) && circle.activeSpeakerIndex !== npc.index) {
      circle.turnQueue.push(npc.index);
    }
    return true;
  }

  /**
   * Complete the active speaker's turn and return the entity index of the next speaker.
   */
  public finishTurn(circleId: string, speaker: Entity, spokenText: string): number | null {
    const circle = this.circles.get(circleId);
    if (!circle) return null;

    circle.turns.push({
      speakerEntityIndex: speaker.index,
      text: spokenText,
      timestamp: Date.now(),
    });

    circle.activeSpeakerIndex = null;
    circle.cooldownUntil = Date.now() + 1000;

    if (circle.turnQueue.length > 0) {
      circle.activeSpeakerIndex = circle.turnQueue.shift()!;
      return circle.activeSpeakerIndex;
    }

    return null;
  }

  /**
   * Inject player dialogue into the circle, triggering responses from participants.
   */
  public injectPlayerSpeech(circleId: string, playerText: string): void {
    const circle = this.circles.get(circleId);
    if (!circle) return;

    circle.turns.push({
      speakerEntityIndex: -1, // -1 denotes Player
      text: playerText,
      timestamp: Date.now(),
    });

    // Queue all participants to react
    circle.turnQueue = [...circle.participantIndices];
  }

  /**
   * Dissolve or leave a circle.
   */
  public leaveCircle(circleId: string, npc: Entity): void {
    const circle = this.circles.get(circleId);
    if (!circle) return;

    circle.participantIndices = circle.participantIndices.filter((idx) => idx !== npc.index);
    circle.turnQueue = circle.turnQueue.filter((idx) => idx !== npc.index);

    if (npc.hasComponent(NPCBanter)) {
      npc.setValue(NPCBanter, 'isBantering', false);
    }

    if (circle.participantIndices.length < 2) {
      this.circles.delete(circleId);
    }
  }

  public getCircle(circleId: string): ConversationCircle | undefined {
    return this.circles.get(circleId);
  }
}
