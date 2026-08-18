/**
 * Cardinal AI Village Experience
 * Sets up 3 intelligent NPCs (Eldrin, Garrick, Sylvia) with 3D avatars,
 * Spatial RAG, Guardrails, Function Calling, RPM Animations, and Live Test HUD.
 */

import {
  World,
  Entity,
  Transform,
  Group,
  Mesh,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Color,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
} from '@iwsdk/core';
import {
  installCardinalAI,
  SmartNPC,
  NPCMemory,
  NPCEmotion,
  EmotionType,
  NPCGazeTracker,
  SpatialVoice,
  SpatialDialogueUI,
  NPCPerception,
  NPCBanter,
  CardinalIntelligenceSystem,
  GroupConversationSystem,
  SpatialRAGSystem,
  AvatarMeshBinder,
  AvatarAnimationController,
} from '@iwsdk/plugin-cardinal-ai';
import { CardinalAIHud } from './ai-hud.js';
import { PhysicsSimulationSystem } from './simulation/PhysicsSimulationSystem.js';

export interface VillageNPCs {
  eldrin: Entity;
  garrick: Entity;
  sylvia: Entity;
  hud: CardinalAIHud;
}

export function setupCardinalVillage(world: World): VillageNPCs {
  // 1. Install Cardinal AI Engine with Cloud / BFF fallback
  installCardinalAI(world, {
    provider: 'cloud',
    cloud: {
      model: 'llama-3.1-8b-instant',
      apiKey: 'demo_key',
    },
  });

  // 1b. Bind RBAC intent policies to each villager archetype — without a
  // registered policy the IntentGuard lets every LLM-emitted intent through.
  const intelligence = world.getSystem(CardinalIntelligenceSystem);
  if (intelligence) {
    intelligence.setSecurityPolicy(1, 'questgiver'); // Eldrin — archimage / lore master
    intelligence.setSecurityPolicy(2, 'guard'); // Garrick — guard captain
    intelligence.setSecurityPolicy(3, 'merchant'); // Sylvia — merchant
  }

  // 2. Index Kingdom Lore into Spatial RAG
  const ragSystem = world.getSystem(SpatialRAGSystem);
  if (ragSystem) {
    ragSystem.registerLore([
      {
        id: 'lore_comet',
        title: 'La Comète Céleste',
        content: 'La Comète Céleste s\'est écrasée il y a trois lunes au sommet du Pic d\'Avernum, libérant des fragments d\'éther magique.',
        sector: 'history',
        tags: ['comete', 'magie', 'avernum'],
      },
      {
        id: 'lore_guard_law',
        title: 'Loi Martiale de la Porte Nord',
        content: 'Les gardes de la citadelle interdisent strictement l\'accès aux armes non déclarées et surveillent toute menace.',
        sector: 'law',
        tags: ['garde', 'securite', 'loi'],
      },
      {
        id: 'lore_potions',
        title: 'Élixirs de Sylvia',
        content: 'Sylvia la marchande possède les dernières potions de soins distillées à partir d\'éther pur de la comète.',
        sector: 'trade',
        tags: ['potion', 'marchande', 'soin'],
      },
    ]);
  }

  // 3. Spawn NPC 1: Eldrin (Archimage / Lore Master) - Masculine Armature & Physics Collider
  const eldrin = world.createEntity();
  eldrin.addComponent(Transform, { position: [0, 0, -3.5] });
  eldrin.addComponent(SmartNPC, {
    personalityId: 1, // Mage archetype
    interactionRadius: 3.5,
    cooldownMs: 1500,
  });
  eldrin.addComponent(NPCMemory, { maxHistoryTurns: 6 });
  eldrin.addComponent(NPCEmotion, { currentEmotion: EmotionType.FRIENDLY, intensity: 0.6 });
  eldrin.addComponent(NPCGazeTracker, { maxTurnAngleDeg: 80, turnSpeed: 4.0 });
  eldrin.addComponent(SpatialVoice, { voiceId: 0, pitch: 0.95 });
  eldrin.addComponent(SpatialDialogueUI, { bubbleHeight: 1.9, showThinkingIndicator: true });
  eldrin.addComponent(NPCPerception, { offeredItemRadius: 2.0, pointedTargetRadius: 4.0 });
  eldrin.addComponent(NPCBanter, {
    talkativeness: 0.8,
    banterRadius: 4.0,
    cooldownMs: 8000,
  });
  eldrin.addComponent(PhysicsShape, {
    shape: PhysicsShapeType.Capsules,
    dimensions: [0.25, 1.8, 0],
    friction: 0.5,
    restitution: 0.0,
  });
  eldrin.addComponent(PhysicsBody, {
    state: PhysicsState.Kinematic,
  });
  const eldrinMesh = createRPMAvatar('Eldrin (Archimage)', 'masculine', 0x2563eb, 0x60a5fa);
  eldrin.object3D?.add(eldrinMesh);
  AvatarMeshBinder.bindAvatar(eldrin, eldrinMesh);
  const eldrinAnim = new AvatarAnimationController(eldrinMesh, { gender: 'masculine' });

  // 4. Spawn NPC 2: Garrick (Guard Captain / Intent Guard) - Masculine Armature & Physics Collider
  const garrick = world.createEntity();
  garrick.addComponent(Transform, { position: [2.2, 0, -3.0] });
  garrick.addComponent(SmartNPC, {
    personalityId: 2, // Guard archetype
    interactionRadius: 3.0,
    cooldownMs: 1500,
  });
  garrick.addComponent(NPCMemory, { maxHistoryTurns: 6 });
  garrick.addComponent(NPCEmotion, { currentEmotion: EmotionType.SUSPICIOUS, intensity: 0.8 });
  garrick.addComponent(NPCGazeTracker, { maxTurnAngleDeg: 70, turnSpeed: 5.0 });
  garrick.addComponent(SpatialVoice, { voiceId: 1, pitch: 0.9 });
  garrick.addComponent(SpatialDialogueUI, { bubbleHeight: 1.9, showThinkingIndicator: true });
  garrick.addComponent(NPCPerception, { offeredItemRadius: 2.5, pointedTargetRadius: 4.5 });
  garrick.addComponent(NPCBanter, {
    talkativeness: 0.6,
    banterRadius: 3.5,
    cooldownMs: 10000,
  });
  garrick.addComponent(PhysicsShape, {
    shape: PhysicsShapeType.Capsules,
    dimensions: [0.25, 1.8, 0],
    friction: 0.5,
    restitution: 0.0,
  });
  garrick.addComponent(PhysicsBody, {
    state: PhysicsState.Kinematic,
  });
  const garrickMesh = createRPMAvatar('Garrick (Capitaine)', 'masculine', 0xb91c1c, 0xf87171);
  garrick.object3D?.add(garrickMesh);
  AvatarMeshBinder.bindAvatar(garrick, garrickMesh);
  const garrickAnim = new AvatarAnimationController(garrickMesh, { gender: 'masculine' });

  // 5. Spawn NPC 3: Sylvia (Merchant / Function Calling) - Feminine Armature & Physics Collider
  const sylvia = world.createEntity();
  sylvia.addComponent(Transform, { position: [-2.2, 0, -3.0] });
  sylvia.addComponent(SmartNPC, {
    personalityId: 3, // Merchant archetype
    interactionRadius: 3.5,
    cooldownMs: 1500,
  });
  sylvia.addComponent(NPCMemory, { maxHistoryTurns: 6 });
  sylvia.addComponent(NPCEmotion, { currentEmotion: EmotionType.EXCITED, intensity: 0.7 });
  sylvia.addComponent(NPCGazeTracker, { maxTurnAngleDeg: 75, turnSpeed: 4.5 });
  sylvia.addComponent(SpatialVoice, { voiceId: 2, pitch: 1.05 });
  sylvia.addComponent(SpatialDialogueUI, { bubbleHeight: 1.9, showThinkingIndicator: true });
  sylvia.addComponent(NPCPerception, { offeredItemRadius: 2.0, pointedTargetRadius: 4.0 });
  sylvia.addComponent(NPCBanter, {
    talkativeness: 0.9,
    banterRadius: 4.0,
    cooldownMs: 7000,
  });
  sylvia.addComponent(PhysicsShape, {
    shape: PhysicsShapeType.Capsules,
    dimensions: [0.25, 1.8, 0],
    friction: 0.5,
    restitution: 0.0,
  });
  sylvia.addComponent(PhysicsBody, {
    state: PhysicsState.Kinematic,
  });
  const sylviaMesh = createRPMAvatar('Sylvia (Marchande)', 'feminine', 0xd97706, 0xfbbf24);
  sylvia.object3D?.add(sylviaMesh);
  AvatarMeshBinder.bindAvatar(sylvia, sylviaMesh);
  const sylviaAnim = new AvatarAnimationController(sylviaMesh, { gender: 'feminine' });

  // 6. Connect Group Conversation Circle between the 3 NPCs
  const groupSystem = world.getSystem(GroupConversationSystem);
  let circleId = '';
  if (groupSystem) {
    circleId = groupSystem.createCircle(
      [eldrin, garrick, sylvia],
      'L\'impact de la comète céleste et la sécurité du village'
    );
  }

  // 7. Interactive Testing HUD
  const hud = new CardinalAIHud(document.body, {
    onTalkToEldrin: () => {
      hud.log('Joueur : "Parle-moi de la comète céleste..."', 'agent');
      eldrinAnim.setTalking(true);
      setTimeout(() => {
        hud.log('Eldrin (RAG) : "La Comète s\'est écrasée il y a trois lunes au Pic d\'Avernum, libérant un éther magique inestimable."', 'rag');
        eldrinAnim.setTalking(false);
      }, 1200);
    },
    onTestGarrickGuardrail: () => {
      hud.log('Joueur : "Puis-je entrer avec des lames forgées ?"', 'agent');
      garrickAnim.setEmotion(EmotionType.HOSTILE);
      garrickAnim.setTalking(true);
      setTimeout(() => {
        hud.log('Garrick (Guardrail) : "Halte ! La Loi Martiale de la Porte Nord interdit formellement les armes non déclarées."', 'guard');
        garrickAnim.setTalking(false);
      }, 1200);
    },
    onTradeWithSylvia: () => {
      hud.log('Joueur : "Je cherche un élixir de soin."', 'agent');
      sylviaAnim.setTalking(true);
      setTimeout(() => {
        hud.log('Sylvia : "Voici votre potion distillée ! [Tool: give_item(potion_01)]"', 'agent');
        sylviaAnim.playEmote('bow');
        sylviaAnim.setTalking(false);
      }, 1200);
    },
    onTriggerGroupBanter: () => {
      hud.log('Déclenchement du Cercle Multi-Agents...', 'info');
      if (groupSystem && circleId) {
        groupSystem.injectPlayerSpeech(circleId, 'Avez-vous remarqué l\'énergie inhabituelle venant du pic ?');
        hud.log('Eldrin -> Garrick -> Sylvia : Échange spontané en cours.', 'agent');
      }
    },
    onTriggerRPMEmote: (emote: string) => {
      hud.log(`Déclenchement Emote RPM: "${emote}" sur Eldrin.`, 'info');
      eldrinAnim.playEmote(emote);
    },
    onThrowPhysicsProp: () => {
      const physicsSys = world.getSystem(PhysicsSimulationSystem);
      if (physicsSys) {
        const stone = physicsSys.spawnPhysicalFlintStone([0, 1.5, -1.2]);
        physicsSys.tossItem(stone, [(Math.random() - 0.5) * 1.5, 3.5, -4.5]);
        hud.log('☄️ Silex physique propulsé avec Havok ! Gravité, rebond et collisions actifs.', 'info');
      }
    },
  });

  return { eldrin, garrick, sylvia, hud };
}

/**
 * Creates a Ready Player Me (Masculine or Feminine Armature) 3D Avatar.
 */
function createRPMAvatar(
  label: string,
  gender: 'masculine' | 'feminine',
  mainColor: number,
  accentColor: number
): Group {
  const group = new Group();
  group.name = label;

  const matBody = new MeshStandardMaterial({ color: new Color(mainColor), roughness: 0.4, metalness: 0.1 });
  const matAccent = new MeshStandardMaterial({ color: new Color(accentColor), roughness: 0.2, metalness: 0.3 });
  const matVisor = new MeshStandardMaterial({ color: 0x111827, roughness: 0.1, metalness: 0.8 });

  // Pedestal
  const pedestal = new Mesh(new CylinderGeometry(0.4, 0.45, 0.1, 24), matBody);
  pedestal.position.set(0, 0.05, 0);
  group.add(pedestal);

  // Ready Player Me Armature Rig
  const isFem = gender === 'feminine';
  const shoulderWidth = isFem ? 0.32 : 0.42;
  const torsoHeight = isFem ? 0.42 : 0.48;

  // Torso / Robe
  const body = new Mesh(new CylinderGeometry(0.18, 0.26, torsoHeight * 1.8, 16), matBody);
  body.position.set(0, 0.55, 0);
  group.add(body);

  // Head (with head bone name for AvatarMeshBinder)
  const head = new Mesh(new SphereGeometry(0.17, 16, 16), matAccent);
  head.name = 'head';
  head.position.set(0, 1.2, 0);
  head.morphTargetDictionary = {
    viseme_aa: 0,
    viseme_E: 1,
    jawOpen: 2,
    eyeBlinkLeft: 3,
    eyeBlinkRight: 4,
  };
  head.morphTargetInfluences = [0, 0, 0, 0, 0];
  group.add(head);

  // Visor / Eyes
  const visor = new Mesh(new BoxGeometry(shoulderWidth * 0.55, 0.06, 0.08), matVisor);
  visor.position.set(0, 1.22, 0.13);
  group.add(visor);

  return group;
}
