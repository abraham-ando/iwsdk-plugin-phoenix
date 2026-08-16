/**
 * Spatial Piper voices for the simulation villagers (spec §10.5). One ECS
 * entity per villager (Transform + SpatialVoice) whose position tracks the
 * avatar every frame, so speech is 3D-positioned on the speaker. Degrades
 * silently when the Cardinal audio stack is not ready.
 */
import { Transform, type Entity, type World } from '@iwsdk/core';
import { CardinalSpatialAudioSystem, SpatialVoice } from '@iwsdk/plugin-cardinal-ai';

export class VillagerVoices {
  private readonly audioSystem: CardinalSpatialAudioSystem | undefined;
  private readonly entities = new Map<string, Entity>();

  constructor(private readonly world: World) {
    this.audioSystem = world.getSystem(CardinalSpatialAudioSystem) ?? undefined;
  }

  register(agentId: string, gender: 'masculine' | 'feminine'): void {
    if (this.entities.has(agentId)) return;
    const entity = this.world.createEntity();
    entity.addComponent(Transform, { position: [0, 0, 0] });
    entity.addComponent(SpatialVoice, {
      voiceId: 0, // numeric field — the system falls back to its default Piper French voice
      pitch: gender === 'feminine' ? 1.12 : 0.92,
    });
    this.entities.set(agentId, entity);
  }

  updatePosition(agentId: string, x: number, y: number, z: number): void {
    const entity = this.entities.get(agentId);
    if (entity === undefined) return;
    // elics 3.4 trap: never setValue on a Vec3 — mutate the vector view.
    const position = entity.getVectorView(Transform, 'position');
    position[0] = x;
    position[1] = y + 1.5; // mouth height, not feet
    position[2] = z;
  }

  speak(agentId: string, text: string): void {
    const entity = this.entities.get(agentId);
    if (entity === undefined || this.audioSystem === undefined) return;
    // Fire-and-forget: speak() itself checks adapter readiness and isPlaying.
    void this.audioSystem.speak(entity, text).catch(() => {});
  }

  dispose(): void {
    for (const entity of this.entities.values()) entity.dispose();
    this.entities.clear();
  }
}
