# @iwsdk/plugin-cardinal-ai

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg)](https://www.typescriptlang.org/)
[![Target: Meta Quest](https://img.shields.io/badge/Target-Meta%20Quest%202%2F3%2F3S%2FPro-0066FF.svg)](https://www.meta.com/quest/)
[![Framework: IWSDK](https://img.shields.io/badge/Framework-IWSDK%20%28%40iwsdk%2Fcore%29-FF4081.svg)](https://github.com/meta-quest)

**Edge AI cognitive engine, local WebGPU SLM inference, procedural gaze IK, 3D spatialized voice (Piper TTS WASM), dynamic LOD 90 FPS, and emergent social interactions for Meta's Immersive Web SDK (`@iwsdk/core`) and the Cardinal architecture.**

---

## 📑 Table des Matières

- [1. Vue d'Ensemble & Architecture](#1-vue-densemble--architecture)
- [2. Matrice des 17 Fonctionnalités Majeures](#2-matrice-des-17-fonctionnalités-majeures)
- [3. Installation](#3-installation)
- [4. Démarrage Rapide](#4-démarrage-rapide)
- [5. Guide Complet des Composants ECS (`elics`)](#5-guide-complet-des-composants-ecs-elics)
- [6. Guide des Systèmes ECS & Priorités d'Exécution](#6-guide-des-systèmes-ecs--priorités-dexécution)
- [7. Modules & Fonctionnalités Avancées](#7-modules--fonctionnalités-avancées)
  - [7.1. Dynamic LOD & Throttling 90 FPS (Meta Quest)](#71-dynamic-lod--throttling-90-fps-meta-quest)
  - [7.2. Réactivité aux Grabbables & Contrôleurs IWSDK](#72-réactivité-aux-grabbables--contrôleurs-iwsdk)
  - [7.3. Gaze IK & Saccades Oculaires Procédurales](#73-gaze-ik--saccades-oculaires-procédurales)
  - [7.4. Streaming de Tokens & Latence Masquée (< 150 ms)](#74-streaming-de-tokens--latence-masquée--150-ms)
  - [7.5. Base Vectorielle de Lore & RAG Spatial 3D](#75-base-vectorielle-de-lore--rag-spatial-3d)
  - [7.6. Lip-Sync & Animation Faciale Morph Targets](#76-lip-sync--animation-faciale-morph-targets)
  - [7.7. Occlusion Acoustique Murale & Cône Vocal Meta](#77-occlusion-acoustique-murale--cône-vocal-meta)
  - [7.8. Dialogues Émergents PNJ-à-PNJ (Banter)](#78-dialogues-émergents-pnj-à-pnj-banter)
  - [7.9. Templates Spatiaux Déclaratifs UIKitML](#79-templates-spatiaux-déclaratifs-uikitml)
  - [7.10. Ancrage Réalité Mixte & Depth Passthrough](#710-ancrage-réalité-mixte--depth-passthrough)
- [8. Tests & Validation](#8-tests--validation)
- [9. Licence](#9-licence)

---

## 1. Vue d'Ensemble & Architecture

`@iwsdk/plugin-cardinal-ai` est conçu spécifiquement pour exécuter une intelligence artificielle complète directement sur le processeur graphique embarqué des casques VR/MR autonomes (**Meta Quest 2, 3, 3S et Pro**) sans impacter la boucle de rendu à 90 FPS.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        ARCHITECTURE GLOBALE CARDINAL AI + IWSDK                        │
│                                                                                        │
│  [ JOUEUR VR & CONTRÔLEURS TOUCH PLUS ]                                                │
│     │ (Micro Casque)       ──► VoiceInputSystem (VAD + stt.worker.ts)                  │
│     │ (Headset Gaze Pose)  ──► GazeIKSystem (Regard, Saccades & Head IK)               │
│     │ (OneHandGrabbable)   ──► GrabbableReactionSystem (Perception objets en main)     │
│     │ (Distance au Casque) ──► AILODSystem (Throttling 90 FPS : FULL/MED/LOW/CULLED)  │
│     │                                                                                  │
│     ▼                                                                                  │
│  [ ECS CONTEXT & RAG ]                                                                 │
│     ├─► CardinalContextBuilder (Météo, Heure, Climat Cardinal)                         │
│     ├─► SpatialRAGSystem (Base de connaissances de lore local par secteur)             │
│     └─► NPCMemory (Ring buffer de mémoire conversationnelle)                           │
│     │                                                                                  │
│     ▼                                                                                  │
│  [ COGNITION & PLANIFICATION 90 FPS ]                                                  │
│     ├─► CognitiveScheduler (Ordonnancement priorisé regard/distance)                   │
│     ├─► NPCEmotion (Humeurs modulant prompts & acoustique)                             │
│     └─► gemma.worker.ts (Inférence WebGPU INT4 optimisée mobile)                       │
│     │                                                                                  │
│     ▼                                                                                  │
│  [ STREAMING & DÉCISION ]                                                              │
│     ├─► SentenceStreamer (Découpage temps réel, latence < 150ms)                       │
│     ├─► IntentParser & IntentDispatcher ([ACTION: GIVE_ITEM, ATTACK...])               │
│     └─► NPCBanterSystem (Dialogues autonomes émergents PNJ-à-PNJ)                      │
│     │                                                                                  │
│     ▼                                                                                  │
│  [ SYNTHÈSE & RENDU MULTISENSORIEL 3D ]                                                │
│     ├─► tts.worker.ts (Synthèse vocale Piper WASM Zero-Copy)                           │
│     ├─► CardinalSpatialAudioSystem (HRTF Meta Quest + Cône Vocal directif 120°)        │
│     ├─► AcousticOcclusionSystem (Filtres passe-bas et atténuation murale)             │
│     ├─► LipSyncSystem (Morph targets Three.js visèmes & mâchoire)                      │
│     ├─► UIKitMLTemplateBuilder (Générateur XML de bulles 3D haute netteté)             │
│     ├─► DialogueBubbleSystem (Bulles 3D & sous-titres karaoké)                         │
│     ├─► MRDepthOcclusionHelper (Ancrage Passthrough & WebXR Depth Sensing)            │
│     └─► AIDebugGizmos (Visualisation des sphères de perception et télémétrie)          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Matrice des 17 Fonctionnalités Majeures

| N° | Axe / Fonctionnalité | Rôle & Innovation Technique |
| :--- | :--- | :--- |
| **1** | **Mémoire Conversationnelle & Humeurs** | Ring buffer glissant multi-tours, 6 états émotionnels (`NEUTRAL`, `JOY`, `ANGER`, `FEAR`, `SADNESS`, `SURPRISE`). |
| **2** | **Intent Calling Structuré** | Détection d'actions dans le texte (`[ACTION: GIVE_ITEM id=potion_01]`) avec dispatching ECS. |
| **3** | **Auto-Contexte Cardinal** | Injection en temps réel de la météo (pluie, orage, brume) et du timestamp mondial ($T_{now}$). |
| **4** | **Scheduler Cognitif 90 FPS** | Ordonnanceur pondéré par produit scalaire de regard (*dot product*) et distance euclidienne. |
| **5** | **Lip-Sync & Animation Faciale 3D** | Morph targets Three.js (`jawOpen`, visèmes `AA`, `O`, `E`) avec lissage exponentiel. |
| **6** | **Capture Vocale VR & VAD** | Enregistrement micro casque, détection d'activité vocale et worker STT non bloquant. |
| **7** | **Gizmos 3D & Télémétrie Live** | Visualisation Three.js des sphères d'audition, de regard et stats de latence/tokens en VR. |
| **8** | **Regard Procédural & Gaze IK** | Orientation progressive tête/cou vers le joueur et micro-saccades oculaires naturelles. |
| **9** | **Dialogues Émergents PNJ-à-PNJ (Banter)** | Discussions autonomes spontanées entre plusieurs PNJs proches avec voix et bulles 3D. |
| **10** | **Streaming Phrase-par-Phrase** | Découpage des tokens par ponctuation pour débuter la diction vocale en temps masqué (< 150 ms). |
| **11** | **RAG Spatial & Lore Vectoriel Local** | Index vectoriel de similarité cosinus ($k$-NN) partitionné par coordonnées $(x,y,z)$. |
| **12** | **Occlusion Acoustique 3D** | Filtres passe-bas (cutoff 700 Hz) et atténuation murale par raycasting ou flag d'occlusion. |
| **13** | **Bulles Spatiales 3D & Karaoké** | Sous-titres 3D flottants au-dessus de l'avatar avec surlignage mot-à-mot calé sur l'audio. |
| **14** | **Dynamic LOD 90 FPS (Meta Quest)** | Throttling adaptatif (`FULL`, `MEDIUM`, `LOW`, `CULLED`) garantissant 72/90/120 FPS. |
| **15** | **Réactivité Grabbables & Rayons IWSDK** | Verrouillage du regard sur les objets tenus (`OneHandGrabbable`) ou pointés du laser. |
| **16** | **Audio HRTF & Cône Vocal Meta Quest** | PannerNode binaural avec cône directif $120^\circ$ (atténuation naturelle de dos). |
| **17** | **Templates Déclaratifs UIKitML** | Balisage XML haute fidélité conforme à `@iwsdk/ui` (styles fantasy, cyberpunk, minimal). |

---

## 3. Installation

```bash
pnpm add @iwsdk/plugin-cardinal-ai
```

---

## 4. Démarrage Rapide

```ts
import { World } from '@iwsdk/core';
import {
  installCardinalAI,
  SmartNPC,
  SpatialVoice,
  NPCMemory,
  NPCEmotion,
  FacialLipSync,
  NPCGazeTracker,
  AILOD,
  CardinalIntelligenceSystem,
  CardinalSpatialAudioSystem,
} from '@iwsdk/plugin-cardinal-ai';

// 1. Initialiser le World ECS IWSDK
const world = new World();

// 2. Installer le plugin Cardinal AI
const ai = installCardinalAI(world, {
  llm: {
    modelId: 'gemma-2b-it-q4f16_1-MLC',
    temperature: 0.7,
    maxTokens: 128,
  },
  tts: {
    voiceId: 'fr_FR-siwis-medium',
    pitch: 1.0,
  },
  onProgress: (progress) => {
    console.log(`[AI Loading] ${progress.text} (${Math.round(progress.progress * 100)}%)`);
  },
});

await ai.ready;

// 3. Créer une entité PNJ complète
const npc = world.createEntity();
npc.addComponent(SmartNPC, { personalityId: 1, interactionRadius: 3.5 });
npc.addComponent(SpatialVoice, { refDistance: 2.0, maxDistance: 25.0 });
npc.addComponent(NPCMemory, { capacity: 8 });
npc.addComponent(NPCEmotion, { currentEmotion: 1, intensity: 0.8 }); // 1 = JOY
npc.addComponent(FacialLipSync, { smoothing: 0.35, intensityMultiplier: 1.2 });
npc.addComponent(NPCGazeTracker, { maxHeadTurnAngleRad: 1.2 });
npc.addComponent(AILOD, {});

// 4. Interagir avec le PNJ
const intelligence = world.getSystem(CardinalIntelligenceSystem);
const response = await intelligence.queryNPC(npc, 'Bonjour gardien, où mène cette porte ?');

// 5. Synthétiser la voix 3D avec Lip-Sync automatique
const audio = world.getSystem(CardinalSpatialAudioSystem);
await audio.speak(npc, response);
```

---

## 5. Guide Complet des Composants ECS (`elics`)

| Composant | Champs Clés | Description |
| :--- | :--- | :--- |
| **`SmartNPC`** | `personalityId`, `interactionRadius`, `systemPromptIndex`, `isThinking` | Configuration cognitive principale du PNJ. |
| **`SpatialVoice`** | `refDistance`, `maxDistance`, `rolloffFactor`, `pitch`, `isPlaying`, `voiceId` | Paramètres audio 3D positionnels. |
| **`NPCMemory`** | `capacity`, `turnCount`, `lastInteractionTimestamp` | Mémoire épisodique glissante. |
| **`NPCEmotion`** | `currentEmotion` (0-5), `intensity` (0-1), `lastStateChange` | Modulateur émotionnel. |
| **`FacialLipSync`** | `jawOpen`, `visemeAA`, `visemeO`, `visemeE`, `smoothing` | Poids de morph targets faciaux. |
| **`VoiceReceiver`** | `isListening`, `vadThreshold`, `sampleRate` | Capture micro joueur & VAD. |
| **`NPCGazeTracker`** | `targetEntityIndex`, `turnSpeed`, `saccadeIntensity`, `isGazingAtPlayer` | Regard IK et micro-saccades oculaires. |
| **`NPCBanter`** | `topicIndex`, `cooldownSeconds`, `isConversing`, `partnerEntityIndex` | Dialogues émergents inter-PNJ. |
| **`SpatialDialogueUI`**| `isBubbleVisible`, `billboardMode`, `speechText`, `karaokeWordIndex` | Sous-titres flottants 3D. |
| **`AILOD`** | `lodLevel` (FULL/MED/LOW/CULLED), `distanceToPlayer`, `updateIntervalMs` | Throttling de budget mobile Quest. |
| **`NPCPerception`** | `offeredItemRadius`, `noticedItemEntityIndex`, `isNoticingItem` | Perception d'objets VR et lasers. |

---

## 6. Guide des Systèmes ECS & Priorités d'Exécution

Tous les systèmes sont ordonnancés après les calculs physiques et de rendu WebXR :

```ts
export const AISystemPriority = {
  AI_LOD: 115,              // Échelonne le coût de frame avant tout calcul
  GRABBABLE_REACTION: 118,  // Détecte les objets offerts par le joueur
  GAZE_IK: 120,             // Oriente le regard et la tête vers la cible
  VOICE_INPUT: 125,         // Analyse l'activité vocale du micro
  SPATIAL_RAG: 128,         // Injecte le lore local dans le prompt
  INTELLIGENCE: 130,        // Exécute l'inférence LLM WebGPU
  BANTER: 132,              // Gère les discussions autonomes PNJ-PNJ
  ACOUSTIC_OCCLUSION: 138,  // Calcule les filtres passe-bas muraux
  SPATIAL_AUDIO: 140,       // Joue la voix 3D avec Panner HRTF
  LIP_SYNC: 145,            // Anime les morph targets Three.js
  DIALOGUE_BUBBLE: 148,     // Met à jour l'UI spatiale et le karaoké
} as const;
```

---

## 7. Modules & Fonctionnalités Avancées

### 7.1. Dynamic LOD & Throttling 90 FPS (Meta Quest)
Garantit une cadence d'images ininterrompue en adaptant le taux de rafraîchissement selon la distance :
- **`< 3.0 m` (FULL) :** Calcul à 90 Hz complet (Lip-sync et regard ultra-précis).
- **`3.0 à 8.0 m` (MEDIUM) :** Throttling à 30 Hz ($33.3\text{ ms}$).
- **`8.0 à 16.0 m` (LOW) :** Throttling à 10 Hz ($100\text{ ms}$).
- **`> 16.0 m` (CULLED) :** Suspension complète des calculs faciaux et IK.

```ts
const lodSystem = world.getSystem(AILODSystem);
lodSystem.setPlayerPosition([playerX, playerY, playerZ]);
```

### 7.2. Réactivité aux Grabbables & Contrôleurs IWSDK
Permet aux PNJ de remarquer un objet tenu en main ou pointé par le joueur :

```ts
const reactionSystem = world.getSystem(GrabbableReactionSystem);

// Écouter lorsqu'un objet est présenté à un PNJ
reactionSystem.onItemOffered(({ npc, itemEntity, itemName }) => {
  console.log(`Le joueur tend ${itemName} au PNJ #${npc.index}`);
});

// Déclencher la perception lors d'une saisie avec OneHandGrabbable
reactionSystem.presentItemToNPC(npcEntity, potionEntity, 'Potion de Soin');
```

### 7.3. Gaze IK & Saccades Oculaires Procédurales
Oriente dynamiquement la tête et les yeux vers le joueur avec micro-mouvements oculaires naturels :

```ts
const gazeSystem = world.getSystem(GazeIKSystem);
gazeSystem.setPlayerHeadPosition([camera.position.x, camera.position.y, camera.position.z]);

// Récupérer les angles de lacet (yaw) et de tangage (pitch) calculés
const { yaw, pitch } = gazeSystem.getHeadEuler(npcEntity);
```

### 7.4. Streaming de Tokens & Latence Masquée (< 150 ms)
Le `SentenceStreamer` découpe le flux de tokens émis par le LLM dès qu'une ponctuation finale (`.`, `!`, `?`, `:`) est rencontrée, démarrant la synthèse vocale Piper en parallèle pendant la suite de la génération :

```ts
import { SentenceStreamer } from '@iwsdk/plugin-cardinal-ai';

const streamer = new SentenceStreamer((sentence) => {
  // Synthétisé immédiatement avant même la fin du texte complet !
  audioSystem.speak(npcEntity, sentence);
});

streamer.pushToken('Bienvenue');
streamer.pushToken(' aventurier');
streamer.pushToken(' !'); // Déclenche 'Bienvenue aventurier !'
```

### 7.5. Base Vectorielle de Lore & RAG Spatial 3D
Injecte des connaissances de quêtes contextuelles basées sur les coordonnées géographiques $(x,y,z)$ :

```ts
import { SpatialVectorStore } from '@iwsdk/plugin-cardinal-ai';

const vectorStore = new SpatialVectorStore();
vectorStore.addDocument({
  id: 'lore_forge_01',
  text: "La forge d'Ignis requiert un cristal de lave pour forger l'armure d'or.",
  position: [12.5, 0.0, -45.0],
  radius: 20.0,
  embedding: [0.12, 0.85, 0.44, /* ... */],
});

// Requête de similarité cosinus avec filtrage de rayon spatial
const relevantLore = vectorStore.search('Comment forger une armure ?', {
  userPosition: [13.0, 0.0, -44.0],
  maxResults: 2,
});
```

### 7.6. Lip-Sync & Animation Faciale Morph Targets
Applique les amplitudes vocales directement sur le mesh Three.js du PNJ :

```ts
import { LipSyncSystem } from '@iwsdk/plugin-cardinal-ai';

const lipSync = world.getSystem(LipSyncSystem);
lipSync.applyMorphTargetsToMesh(npcMesh, npcEntity);
```

### 7.7. Occlusion Acoustique Murale & Cône Vocal Meta
Atténue le son et applique un filtre passe-bas ($700\text{ Hz}$) si un mur obstrue la ligne de vue :

```ts
const occlusionSystem = world.getSystem(AcousticOcclusionSystem);
occlusionSystem.setOccluded(npcEntity, true); // Filtre passe-bas actif
```

### 7.8. Dialogues Émergents PNJ-à-PNJ (Banter)
Déclenche des discussions autonomes lorsque deux PNJ sont proches :

```ts
const banterSystem = world.getSystem(NPCBanterSystem);
banterSystem.triggerBanter(guardNPC, merchantNPC, 'Rumeurs sur la porte nord');
```

### 7.9. Templates Spatiaux Déclaratifs UIKitML
Génération de balisage XML spatial conforme à `@iwsdk/ui` :

```ts
import { UIKitMLTemplateBuilder } from '@iwsdk/plugin-cardinal-ai';

const xmlMarkup = UIKitMLTemplateBuilder.buildSpeechBubble({
  npcName: 'Aldric le Forgeron',
  theme: 'fantasy', // 'fantasy' | 'cyberpunk' | 'minimal'
  speechText: 'Approche, que puis-je forger pour toi ?',
  karaokeWordIndex: 2,
  emotionTag: 'JOY',
});
```

### 7.10. Ancrage Réalité Mixte & Depth Passthrough
Configuration des matériaux Three.js pour occlusion par la géométrie réelle de la pièce :

```ts
import { MRDepthOcclusionHelper } from '@iwsdk/plugin-cardinal-ai';

MRDepthOcclusionHelper.applyMROcclusion(npcObject3D, {
  depthTest: true,
  depthWrite: true,
  renderOrderOffset: 1,
});
```

---

## 8. Tests & Validation

L'ensemble de la suite de tests est exécutable via Vitest :

```bash
# Lancer les tests unitaires du package IA (21 fichiers, 33 tests)
pnpm --filter @iwsdk/plugin-cardinal-ai test

# Vérification TypeScript stricte
pnpm --filter @iwsdk/plugin-cardinal-ai typecheck

# Compilation de production
pnpm --filter @iwsdk/plugin-cardinal-ai build

# Validation globale du monorepo (249 tests)
pnpm test && pnpm typecheck && pnpm build
```

---

## 9. Licence

MIT © IWSDK & Phoenix Monorepo Contributors.
