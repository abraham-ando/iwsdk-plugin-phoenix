# @iwsdk/plugin-cardinal-ai

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg)](https://www.typescriptlang.org/)
[![Target: Meta Quest](https://img.shields.io/badge/Target-Meta%20Quest%202%2F3%2F3S%2FPro-0066FF.svg)](https://www.meta.com/quest/)
[![Framework: IWSDK](https://img.shields.io/badge/Framework-IWSDK%20%28%40iwsdk%2Fcore%29-FF4081.svg)](https://github.com/meta-quest)

**Edge AI cognitive engine, multi-model WebGPU SLM inference, Tri-Modal LLM providers (Local WebGPU, Cloud, Self-Hosted/Ollama), procedural gaze IK, 3D spatialized voice (Piper TTS WASM), dynamic LOD 90 FPS, persistent OPFS caching, and emergent social interactions for Meta's Immersive Web SDK (`@iwsdk/core`) and the Cardinal architecture.**

---

## 📑 Table des Matières

- [1. Vue d'Ensemble & Architecture](#1-vue-densemble--architecture)
- [2. Tri-Mode d'Inférence LLM (WebGPU / Cloud / Self-Hosted)](#2-tri-mode-dinférence-llm-webgpu--cloud--self-hosted)
- [3. Gestion du Cache & Stockage sur Meta Quest (OPFS / Cache API)](#3-gestion-du-cache--stockage-sur-meta-quest-opfs--cache-api)
- [4. Matrice des Fonctionnalités Majeures](#4-matrice-des-fonctionnalités-majeures)
- [5. Installation](#5-installation)
- [6. Démarrage Rapide (3 Exemples)](#6-démarrage-rapide-3-exemples)
- [7. Guide Complet des Composants ECS (`elics`)](#7-guide-complet-des-composants-ecs-elics)
- [8. Guide des Systèmes ECS & Priorités d'Exécution](#8-guide-des-systèmes-ecs--priorités-dexécution)
- [9. Modules & Fonctionnalités Avancées](#9-modules--fonctionnalités-avancées)
  - [9.1. Dynamic LOD & Throttling 90 FPS (Meta Quest)](#91-dynamic-lod--throttling-90-fps-meta-quest)
  - [9.2. Réactivité aux Grabbables & Contrôleurs IWSDK](#92-réactivité-aux-grabbables--contrôleurs-iwsdk)
  - [9.3. Gaze IK & Saccades Oculaires Procédurales](#93-gaze-ik--saccades-oculaires-procédurales)
  - [9.4. Streaming de Tokens & Latence Masquée (< 150 ms)](#94-streaming-de-tokens--latence-masquée--150-ms)
  - [9.5. Base Vectorielle de Lore & RAG Spatial 3D](#95-base-vectorielle-de-lore--rag-spatial-3d)
  - [9.6. Lip-Sync & Animation Faciale Morph Targets](#96-lip-sync--animation-faciale-morph-targets)
  - [9.7. Occlusion Acoustique Murale & Cône Vocal Meta](#97-occlusion-acoustique-murale--cône-vocal-meta)
  - [9.8. Dialogues Émergents PNJ-à-PNJ (Banter)](#98-dialogues-émergents-pnj-à-pnj-banter)
  - [9.9. Templates Spatiaux Déclaratifs UIKitML](#99-templates-spatiaux-déclaratifs-uikitml)
  - [9.10. Ancrage Réalité Mixte & Depth Passthrough](#910-ancrage-réalité-mixte--depth-passthrough)
  - [9.11. Sécurité, Guardrails & Anti-Jailbreak (IntentGuard)](#911-sécurité-guardrails--anti-jailbreak-intentguard)
  - [9.12. BFF Proxy & Authentification par Session JWT (TokenManager)](#912-bff-proxy--authentification-par-session-jwt-tokenmanager)
  - [9.13. Structured Outputs & JSON Schema Tool Calling](#913-structured-outputs--json-schema-tool-calling)
  - [9.14. Speculative Decoding Multi-Modèles (WebGPU 3x Speedup)](#914-speculative-decoding-multi-modèles-webgpu-3x-speedup)
  - [9.15. Dynamique Sociale de Groupe & Turn-Taking (GroupConversationSystem)](#915-dynamique-sociale-de-groupe--turn-taking-groupconversationsystem)
  - [9.16. Streaming Audio Zero-Copy Haute Performance (AudioWorkletManager)](#916-streaming-audio-zero-copy-haute-performance-audioworkletmanager)
- [10. Tests & Validation](#10-tests--validation)
- [11. Licence](#11-licence)

---

## 1. Vue d'Ensemble & Architecture

`@iwsdk/plugin-cardinal-ai` est conçu spécifiquement pour exécuter ou relier une intelligence artificielle complète en réalité virtuelle/mixte (**Meta Quest 2, 3, 3S et Pro**) sans impacter la boucle de rendu à 90 FPS.

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
│  [ COGNITION & INFÉRENCE TRI-MODALE ]                                                  │
│     ├─► Mode 'local-webgpu' : llm.worker.ts (Llama 3.2, Qwen 2.5, Gemma 2, Phi 3.5)   │
│     ├─► Mode 'cloud'        : CloudInferenceAdapter (Groq, OpenAI, DeepSeek, OpenRouter)│
│     └─► Mode 'self-hosted'  : SelfHostedInferenceAdapter (Ollama, LM Studio, vLLM LAN) │
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

## 2. Tri-Mode d'Inférence LLM (WebGPU / Cloud / Self-Hosted)

Le moteur supporte **3 modes d'inférence interchangeables** configurables via l'option `provider` :

| Mode | Fournisseur / Backend | Avantages VR / Meta Quest | Cas d'Usage Idéal |
| :--- | :--- | :--- | :--- |
| **`local-webgpu`** | `llm.worker.ts` (WebGPU) | 100% hors-ligne, zéro latence réseau, respecte le GPU Quest. | Déploiement autonome autonome sans internet. |
| **`self-hosted`** | Ollama, LM Studio, vLLM sur LAN Wi-Fi | Zéro token payant, aucun modèle lourd sur le casque, GPU PC puissant (RTX). | Développement local, démos privées, jeux VR locaux. |
| **`cloud`** | Groq, OpenAI, DeepSeek, OpenRouter | Latence minimale (~100 ms sur Groq), modèles de pointe (70B, GPT-4o-mini). | Expériences connectées avec intelligence maximale. |

---

## 3. Gestion du Cache & Stockage sur Meta Quest (OPFS / Cache API)

Pour éviter de retélécharger les 700 Mo à 1.5 Go de poids de modèles à chaque ouverture sur Meta Quest Browser :

1. **Origin Private File System (`OPFS`) :** Système de fichiers virtuel sandboxé, rapide et persistant.
2. **Cache Storage API (`caches.open()`) :** Mise en cache permanente des shards binaires WASM et poids de tenseurs.
3. **`ModelCacheManager` :** API complète pour vérifier l'état du cache, inspecter le quota restant (`navigator.storage.estimate()`), et vider le cache.

```ts
import { ModelCacheManager } from '@iwsdk/plugin-cardinal-ai';

// Vérifier si un modèle est déjà téléchargé
const isReady = await ModelCacheManager.isModelCached('llama-3.2-1b-it-q4f16-MLC', 'opfs');

// Consulter le stockage disponible sur le Meta Quest
const { usageMb, quotaMb } = await ModelCacheManager.getStorageQuota();
console.log(`Espace utilisé : ${usageMb} Mo / ${quotaMb} Mo`);

// Vider le cache d'un modèle spécifique
await ModelCacheManager.clearCache('llama-3.2-1b-it-q4f16-MLC');
```

---

## 4. Matrice des Fonctionnalités Majeures

| N° | Fonctionnalité | Rôle & Innovation Technique |
| :--- | :--- | :--- |
| **1** | **Multi-Modèles WebGPU Agnostique** | Supporte Llama 3.2, Qwen 2.5, Phi-3.5, Gemma 2, SmolLM dans `llm.worker.ts`. |
| **2** | **Tri-Mode d'Inférence** | Bascule transparente entre `local-webgpu`, `cloud`, et `self-hosted` (Ollama LAN). |
| **3** | **Persistance OPFS & Cache API** | Caching local persistant des modèles sur Meta Quest Browser. |
| **4** | **Mémoire Conversationnelle & Humeurs** | Ring buffer multi-tours, 6 émotions (`NEUTRAL`, `JOY`, `ANGER`, `FEAR`, `SADNESS`, `SURPRISE`). |
| **5** | **Intent Calling Structuré** | Extraction d'actions dans le texte (`[ACTION: GIVE_ITEM id=potion_01]`) avec dispatching ECS. |
| **6** | **Auto-Contexte Cardinal** | Injection en temps réel de la météo et du timestamp mondial ($T_{now}$). |
| **7** | **Scheduler Cognitif 90 FPS** | Ordonnanceur pondéré par produit scalaire de regard (*dot product*) et distance. |
| **8** | **Lip-Sync & Animation Faciale 3D** | Morph targets Three.js (`jawOpen`, visèmes `AA`, `O`, `E`) avec lissage exponentiel. |
| **9** | **Capture Vocale VR & VAD** | Enregistrement micro casque, détection d'activité vocale et worker STT non bloquant. |
| **10** | **Gizmos 3D & Télémétrie Live** | Visualisation Three.js des sphères d'audition, de regard et stats de latence/tokens en VR. |
| **11** | **Regard Procédural & Gaze IK** | Orientation progressive tête/cou vers le joueur et micro-saccades oculaires naturelles. |
| **12** | **Dialogues Émergents PNJ-à-PNJ (Banter)** | Discussions autonomes spontanées entre plusieurs PNJs proches avec voix et bulles 3D. |
| **13** | **Streaming Phrase-par-Phrase** | Découpage des tokens par ponctuation pour débuter la diction vocale en temps masqué (< 150 ms). |
| **14** | **RAG Spatial & Lore Vectoriel Local** | Index vectoriel de similarité cosinus ($k$-NN) partitionné par coordonnées $(x,y,z)$. |
| **15** | **Occlusion Acoustique 3D** | Filtres passe-bas (cutoff 700 Hz) et atténuation murale par raycasting ou flag d'occlusion. |
| **16** | **Bulles Spatiales 3D & Karaoké** | Sous-titres 3D flottants au-dessus de l'avatar avec surlignage mot-à-mot calé sur l'audio. |
| **17** | **Dynamic LOD 90 FPS (Meta Quest)** | Throttling adaptatif (`FULL`, `MEDIUM`, `LOW`, `CULLED`) garantissant 72/90/120 FPS. |
| **18** | **Réactivité Grabbables & Rayons IWSDK** | Verrouillage du regard sur les objets tenus (`OneHandGrabbable`) ou pointés du laser. |
| **19** | **Audio HRTF & Cône Vocal Meta Quest** | PannerNode binaural avec cône directif $120^\circ$ (atténuation naturelle de dos). |
| **20** | **Templates Déclaratifs UIKitML** | Balisage XML haute fidélité conforme à `@iwsdk/ui` (styles fantasy, cyberpunk, minimal). |

---

## 5. Installation

```bash
pnpm add @iwsdk/plugin-cardinal-ai
```

---

## 6. Démarrage Rapide (3 Exemples)

### Exemple 1 : Local WebGPU (100% Hors-Ligne sur Meta Quest)

```ts
import { World } from '@iwsdk/core';
import { installCardinalAI } from '@iwsdk/plugin-cardinal-ai';

const world = new World();

const ai = installCardinalAI(world, {
  provider: 'local-webgpu',
  llm: {
    modelId: 'llama-3.2-1b-it-q4f16-MLC', // ou 'qwen2.5-1.5b-it-q4f16', 'gemma-2b-it-q4f16_1-MLC'
    cacheType: 'opfs',
    temperature: 0.7,
    maxTokens: 128,
  },
  tts: {
    voiceId: 'fr_FR-siwis-medium',
  },
  onProgress: (progress) => {
    console.log(`[AI Progress] ${progress.text} (${Math.round(progress.progress * 100)}%)`);
  },
});

await ai.ready;
```

### Exemple 2 : Self-Hosted (Ollama / LM Studio sur PC en Wi-Fi)

```ts
const ai = installCardinalAI(world, {
  provider: 'self-hosted',
  selfHosted: {
    endpoint: 'http://192.168.1.50:11434', // IP locale du PC avec Ollama
    model: 'llama3.2:3b',
    serverType: 'ollama',
  },
  tts: { voiceId: 'fr_FR-siwis-medium' },
});

await ai.ready;
```

### Exemple 3 : Cloud Provider (Groq / OpenAI / DeepSeek)

```ts
const ai = installCardinalAI(world, {
  provider: 'cloud',
  cloud: {
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
    model: 'llama-3.1-8b-instant', // Latence ultra-faible ~100ms
  },
  tts: { voiceId: 'fr_FR-siwis-medium' },
});

await ai.ready;
```

---

## 7. Guide Complet des Composants ECS (`elics`)

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

## 8. Guide des Systèmes ECS & Priorités d'Exécution

```ts
export const AISystemPriority = {
  AI_LOD: 115,              // Échelonne le coût de frame avant tout calcul
  GRABBABLE_REACTION: 118,  // Détecte les objets offerts par le joueur
  GAZE_IK: 120,             // Oriente le regard et la tête vers la cible
  VOICE_INPUT: 125,         // Analyse l'activité vocale du micro
  SPATIAL_RAG: 128,         // Injecte le lore local dans le prompt
  INTELLIGENCE: 130,        // Exécute l'inférence LLM (Local/Cloud/LAN)
  BANTER: 132,              // Gère les discussions autonomes PNJ-PNJ
  ACOUSTIC_OCCLUSION: 138,  // Calcule les filtres passe-bas muraux
  SPATIAL_AUDIO: 140,       // Joue la voix 3D avec Panner HRTF
  LIP_SYNC: 145,            // Anime les morph targets Three.js
  DIALOGUE_BUBBLE: 148,     // Met à jour l'UI spatiale et le karaoké
} as const;
```

---

## 9. Modules & Fonctionnalités Avancées

### 9.1. Dynamic LOD & Throttling 90 FPS (Meta Quest)
- **`< 3.0 m` (FULL) :** Calcul à 90 Hz complet (Lip-sync et regard ultra-précis).
- **`3.0 à 8.0 m` (MEDIUM) :** Throttling à 30 Hz ($33.3\text{ ms}$).
- **`8.0 à 16.0 m` (LOW) :** Throttling à 10 Hz ($100\text{ ms}$).
- **`> 16.0 m` (CULLED) :** Suspension complète des calculs faciaux et IK.

### 9.2. Réactivité aux Grabbables & Contrôleurs IWSDK
```ts
const reactionSystem = world.getSystem(GrabbableReactionSystem);
reactionSystem.onItemOffered(({ npc, itemEntity, itemName }) => {
  console.log(`Le joueur tend ${itemName} au PNJ #${npc.index}`);
});
```

### 9.3. Gaze IK & Saccades Oculaires Procédurales
```ts
const gazeSystem = world.getSystem(GazeIKSystem);
gazeSystem.setPlayerHeadPosition([camera.position.x, camera.position.y, camera.position.z]);
const { yaw, pitch } = gazeSystem.getHeadEuler(npcEntity);
```

### 9.4. Streaming de Tokens & Latence Masquée (< 150 ms)
```ts
import { SentenceStreamer } from '@iwsdk/plugin-cardinal-ai';

const streamer = new SentenceStreamer((sentence) => {
  audioSystem.speak(npcEntity, sentence);
});
streamer.pushToken('Bienvenue');
streamer.pushToken(' aventurier');
streamer.pushToken(' !');
```

### 9.11. Sécurité, Guardrails & Anti-Jailbreak (IntentGuard)
Protège le jeu contre les attaques par injection de prompt et filtre les actions PNJ selon leur rôle :
```ts
import { IntentGuard } from '@iwsdk/plugin-cardinal-ai';

// Nettoie la voix du joueur avant injection dans le LLM
const safeText = IntentGuard.sanitizePlayerInput(rawPlayerSpeech);

// Valide si l'action générée est autorisée pour ce marchand
const policy = IntentGuard.getRolePolicy('merchant');
const validation = IntentGuard.validateIntent('SELL_ITEM', { itemId: 'sword_01' }, policy);
if (validation.isValid) {
  // Exécuter l'action ECS
}
```

### 9.12. BFF Proxy & Authentification par Session JWT (TokenManager)
Évite d'embarquer des clés API en clair dans le client WebXR :
```ts
import { installCardinalAI } from '@iwsdk/plugin-cardinal-ai';

installCardinalAI(world, {
  provider: 'cloud',
  cloud: {
    model: 'llama-3.1-8b-instant',
    proxyUrl: '/api/v1/cardinal/chat', // BFF Backend proxy
    tokenProvider: async () => {
      const res = await fetch('/api/auth/session-token');
      return res.json(); // { token: 'jwt...', expiresInSeconds: 3600 }
    },
  },
});
```

### 9.13. Structured Outputs & JSON Schema Tool Calling
Génération d'appels d'outils typés et nettoyage automatique de la voix synthétisée :
```ts
import { FunctionCallingSchema, StructuredOutputParser } from '@iwsdk/plugin-cardinal-ai';

// Injecte le schéma JSON dans le system prompt
const toolsPrompt = FunctionCallingSchema.formatToolsForSystemPrompt([
  FunctionCallingSchema.STANDARD_TOOLS.GIVE_ITEM,
  FunctionCallingSchema.STANDARD_TOOLS.PLAY_EMOTE,
]);

// Analyse le retour du LLM (JSON tool calls ou tags)
const { cleanText, toolCalls } = StructuredOutputParser.parse(llmRawResponse);
// cleanText -> lu par le TTS (ex: "Prenez cette potion !")
// toolCalls -> exécuté en ECS (ex: [{ tool: 'give_item', args: { itemId: 'potion_01' } }])
```

### 9.14. Speculative Decoding Multi-Modèles (WebGPU 3x Speedup)
Accélère l'inférence WebGPU en utilisant un petit modèle brouillon (ex: SmolLM 135M) vérifié en parallèle par le modèle cible (ex: Llama 3.2 3B) :
```ts
import { SpeculativeDecodingEngine } from '@iwsdk/plugin-cardinal-ai';

const engine = new SpeculativeDecodingEngine({
  targetModelId: 'llama-3.2-3b-instruct-q4f16-MLC',
  draftModelId: 'smollm2-135m-instruct-q4f16-MLC',
  draftSteps: 4,
  acceptanceThreshold: 0.75,
});
```

### 9.15. Dynamique Sociale de Groupe & Turn-Taking (GroupConversationSystem)
Orchestration naturelle de discussions à 3+ PNJ sans chevauchement vocal dans l'espace 3D :
```ts
import { GroupConversationSystem } from '@iwsdk/plugin-cardinal-ai';

const groupSystem = world.getSystem(GroupConversationSystem);
const circleId = groupSystem.createCircle([eldrinEntity, garrickEntity, sylviaEntity], 'La comète céleste');

// Le joueur intervient dans le cercle :
groupSystem.injectPlayerSpeech(circleId, 'Avez-vous vu la lumière au sommet ?');
```

### 9.16. Streaming Audio Zero-Copy Haute Performance (AudioWorkletManager)
Gestion des flux audio PCM par ring-buffer circulaire sans saccades du Garbage Collector :
```ts
import { AudioWorkletManager } from '@iwsdk/plugin-cardinal-ai';

const audioManager = new AudioWorkletManager(24000);
audioManager.enqueueChunk(pcmFloat32Chunk);
const samples = audioManager.readSamples(1024);
```

---

## 10. Tests & Validation

```bash
# Tests unitaires du package IA (31 fichiers, 67 tests)
pnpm --filter @iwsdk/plugin-cardinal-ai test

# Compilation de production TypeScript & Bundle
pnpm --filter @iwsdk/plugin-cardinal-ai build

# Validation globale du monorepo (283 tests, 0 erreur)
pnpm test && pnpm typecheck && pnpm build
```

---

## 11. Licence

MIT © IWSDK & Phoenix Monorepo Contributors.
