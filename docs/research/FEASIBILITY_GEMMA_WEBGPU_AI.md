# Étude de Faisabilité Technique & Architecturale : Edge AI Gemma (WebGPU) + TTS Local 3D dans le Moteur Cardinal

**Statut :** Analyse Complète & Spécification Préparatoire (Cardinal Layer 3)  
**Date :** 15 Août 2026  
**Cible Matérielle :** Meta Quest 2, Meta Quest 3 / 3S, Meta Quest Pro (Horizon OS, Meta Quest Browser WebXR)  
**Stack Logicielle :** `@iwsdk/core` (elics ECS), Three.js (WebGL), WebGPU Compute (Headless), Phoenix Channels (Elixir/BEAM), WebLLM / ONNX Runtime WebGPU, Piper TTS WASM, Web Audio API.

---

## 1. Synthèse Exécutive

L'idée d'embarquer un modèle de langage compact (SLM - *Small Language Model*) de type **Gemma 2B quantisé (INT4/FP4 ~700 Mo - 1.2 Go)** ou sub-1B (ex: SmolLM-360M / Llama-3.2-1B) exécuté localement sur **WebGPU** à l'intérieur d'un Web Worker dédié, couplé à une synthèse vocale locale (**TTS WASM/ONNX**) et à un rendu audio spatialisé 3D sous `@iwsdk/core`, est **techniquement viable et conceptuellement remarquable**, mais elle est **soumise à des contraintes physiques et logicielles extrêmes sur les casques VR autonomes**.

### Verdict Global de Faisabilité

| Plateforme | Faisabilité Globale | Statut VRAM / RAM | Risque Frame Drops (90 FPS) | Recommandation |
| :--- | :--- | :--- | :--- | :--- |
| **Meta Quest 2** (6 Go RAM unifiée) | ❌ **NON VIABLE** | 🔴 OOM Crash quasi-systématique (dépassement des ~500 Mo libres) | Élevé | Rejeté pour les modèles > 300 Mo. |
| **Meta Quest 3 / 3S** (8 Go RAM unifiée) | ⚠️ **VIABLE SOUS CONDITIONS STRICTES** | 🟡 Marge étroite (~1.2 - 1.8 Go max allouables à l'IA) | Modéré à Critique selon le Time-Slicing | **Validé** avec modèle ≤ 800 Mo (INT4) + Event-Driven. |
| **Meta Quest Pro** (12 Go RAM unifiée) | ✅ **PARFAITEMENT VIABLE** | 🟢 Confortable (~4-5 Go disponibles) | Faible si Worker isolé | **Validé** jusqu'à Gemma-2-2B (INT4). |
| **PCVR / Desktop Chromium** | ✅ **100% VIABLE** | 🟢 VRAM dédiée abondante | Nul | Environnement de référence pour tests. |

---

## 2. Analyse des Contraintes Matérielles du Meta Quest

### 2.1. Pression Mémoire Unifiée (RAM / VRAM)

Contrairement à un PC de bureau doté d'une mémoire système et d'une VRAM GPU distinctes, les puces Snapdragon XR2 (Qualcomm) partagent une mémoire unifiée (LPDDR5).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RÉPARTITION MÉMOIRE - META QUEST 3 (8 GO)                │
├───────────────────┬───────────────────────────────────┬─────────────────────┤
│ SYSTÈME & BASE    │ MOTEUR 3D / VR RENDU (WebXR)      │ MARGE TOTALE IA     │
│ ~3.0 Go           │ ~2.5 - 3.2 Go                     │ ~1.8 - 2.5 Go       │
├───────────────────┼───────────────────────────────────┼─────────────────────┤
│ - Horizon OS      │ - Oculus VR Compositor (4K Stereo)│ - Gemma INT4 Poids  │
│ - Android Runtime │ - Double/Triple Render Targets    │   (~700 - 900 Mo)   │
│ - Quest Browser   │ - Three.js WebGL Geometries/Tex   │ - KV-Cache (256 tok)│
│ - Tab Overhead    │ - Havok Physics WASM Heap         │   (~150 - 300 Mo)   │
│                   │ - elics ECS Typed Arrays Columnar │ - WebLLM Work Buffs │
│                   │ - RingBuffer / SharedArrayBuffer  │ - TTS Model (Piper) │
│                   │                                   │   (~30 - 60 Mo)     │
└───────────────────┴───────────────────────────────────┴─────────────────────┘
```

> [!WARNING]
> **Le piège du crash OOM (Out-Of-Memory) :**
> Si la consommation mémoire du navigateur dépasse le seuil alloué par Android/Horizon OS (~5.5 Go max pour une application/onglet), le `lowmemorykiller` de l'OS tue instantanément l'onglet du navigateur sans avertissement.
> **Règle absolue :** L'empreinte mémoire totale de l'IA (poids + runtime WebGPU + KV cache + TTS) ne doit **jamais dépasser 1.4 Go** sur Quest 3.

### 2.2. Le Budget Temps de Trame (11.1 ms à 90 FPS) & Goulot GPU

En VR immersive, le respect du taux de rafraîchissement (72, 80 ou 90 Hz) est une exigence de confort physiologique (prévention de la cinétose / mal des transports).

- À **90 FPS**, la frame entière (CPU simulation + GPU WebGL eye passes + Compositor) doit s'exécuter en **moins de 11.11 ms**.
- **Problème fondamental :** Même si le LLM s'exécute dans un Web Worker séparé côté CPU, **le GPU Adreno 740 est physiquement unique**.
- Les opérations de multiplication matricielle (GEMM) du compute shader WebGPU sollicitent les mêmes unités de calcul (ALUs / Shader Cores) et la même bande passante mémoire que le pipeline de rendu WebGL de Three.js.
- **Solution d'ingénierie :** Le moteur d'inférence (WebLLM / TVM) doit être configuré avec un **Time-Slicing coopératif**. Les dispatches de calcul ne doivent pas monopoliser la file `GPUQueue`. L'inférence doit générer des tokens par fragments discrets (ex: 2 ms max de calcul compute par trame, ou 5-10 tokens par seconde échelonnés sur plusieurs frames).

### 2.3. Gestion Thermique (Thermal Throttling) et Consommation Énergétique

Un casque Quest 3 dispose d'une enveloppe thermique (TDP) d'environ 6 à 8 Watts.
- L'inférence LLM continue (en boucle) pousse le GPU à 100% de sa fréquence d'horloge.
- Après 4 à 7 minutes d'inférence continue, le contrôleur thermique de l'OS force le bridage des fréquences (Thermal Throttling de -30% à -50%), provoquant un effondrement dramatique des FPS en plein jeu.
- **Solution d'ingénierie : Architecture Purement Événementielle (Event-Driven).**
  - Pas d'inférence en arrière-plan permanente.
  - L'IA n'est éveillée que par :
    1. Interaction directe du joueur (distance < 3 mètres + regard / prise de parole).
    2. Événement tactique critique émis par le serveur Phoenix (changement d'état d'un combat, alerte de faction).

---

## 3. Analyse de l'Écosystème WebGPU & WebXR sur Meta Quest

### 3.1. Support de WebGPU dans Meta Quest Browser

1. **Rendu WebXR en WebGPU :** Non disponible actuellement sur Quest. Le rendu WebXR se fait via WebGL 2.0 (`WebGLRenderer` de Three.js).
2. **WebGPU Compute Headless dans un Web Worker :** Quest Browser 146.0+ supporte expérimentalement WebGPU. L'instanciation de `navigator.gpu.requestAdapter()` et `adapter.requestDevice()` dans un contexte de Web Worker (`WorkerNavigator.gpu`) fonctionne pour les calculs GPGPU purs.
3. **Absence de conflit de contexte :** Le thread principal utilise son contexte `WebGL2RenderingContext` pour le rendu vers le canvas XR, tandis que le Worker instancie son propre `GPUDevice` headless pour l'exécution des compute shaders de Gemma.

---

## 4. Architecture Hybride "Dual-Brain" : Phoenix BEAM vs Gemma WebGPU

L'architecture s'aligne parfaitement avec les fondations du projet `iwsdk-plugin-phoenix` :

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                MACRO-CERVEAU (Serveur Phoenix / BEAM)                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ - Maintien de l'état d'autorité du monde ($T_{now}$, météo, cycle jour/nuit)           │
│ - Gestion des secteurs persistants (`IwsdkPhoenix.World.Snapshots`)                    │
│ - Réplication AoI spatiale via `IwsdkPhoenix.SpatialGrid`                              │
│ - Validation physique cinématique (`IwsdkPhoenix.Physics.Kinematic`)                   │
│ - Émission des composants Cardinal (`COMPONENT_UPDATE`, op 12)                        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ WebSocket binaire (30 Hz / 15 Hz LOD)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT WEBXR (Meta Quest 3)                             │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                        NETWORK WORKER (`network.worker.ts`)                    │   │
│   │   - Décodage binaire, gestion de la socket Phoenix                             │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │ Zero-Copy SharedArrayBuffer / Transferable │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                     MAIN RENDER THREAD (`@iwsdk/core` - elics ECS)             │   │
│   ├────────────────────────────────────────────────────────────────────────────────┤   │
│   │ - Rendu WebGL Three.js (90 FPS)                                                │   │
│   │ - Systèmes : `PhoenixNetworkSystem`, `CardinalSpatialAudioSystem`,             │   │
│   │              `CardinalIntelligenceSystem`                                      │   │
│   │ - Composants elics : `Networked`, `SmartNPC`, `SpatialVoice`                   │   │
│   └───────────────┬────────────────────────────────────────────────▲───────────────┘   │
│                   │ Requête d'inférence (Prompt structuré)         │ PCM Audio 3D      │
│                   │ + Snapshot Contexte Monde ($T_{now}$, Météo)   │ (Zero-Copy)       │
│                   ▼                                                │                   │
│   ┌──────────────────────────────────────────────┐   ┌─────────────┴───────────────┐   │
│   │         GEMMA WORKER (WebGPU Compute)        │   │          TTS WORKER         │   │
│   ├──────────────────────────────────────────────┤   ├─────────────────────────────┤   │
│   │ - Modèle Gemma INT4 (~700 Mo) en VRAM        │   │ - Piper TTS WASM (~30 Mo)   │   │
│   │ - WebLLM / MLC Execution Pipeline            ├──►│ - Génération audio Float32  │   │
│   │ - Génération de texte & décisions            │   │ - Débit ~15x temps réel     │   │
│   └──────────────────────────────────────────────┘   └─────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Synthèse Vocale (TTS) : SpeechT5 vs Piper WASM

Le prompt utilisateur mentionnait l'utilisation de `Xenova/speecht5_tts` via Transformers.js.

> [!CAUTION]
> **Inadéquation de SpeechT5 sur Casque Mobile :**
> - Modèle SpeechT5 : Poids de **~350 Mo**, calcul lourd en autorégression séquentielle.
> - Sur CPU mobile Snapdragon en WASM, la synthèse d'une phrase prend **entre 2.5 et 6 secondes** (facteur temps réel > 1.0), ce qui détruit l'immersion en VR.
> - **Alternative Hautement Recommandée : Piper TTS (WASM/ONNX)** ou **Kokoro-82M (ONNX)**.
>   - Poids : **~25 à 50 Mo** par voix.
>   - Modèle VITS non-autorégressif (synthèse en un seul passage).
>   - Vitesse : **0.1x à 0.2x temps réel** (une phrase de 5 secondes est générée en 400 ms sur CPU WASM SIMD).

---

## 6. Alignement avec le Vrai Runtime IWSDK (`@iwsdk/core` & `elics`)

Comme documenté dans [`docs/FEASIBILITY.md`](file:///Volumes/AZA-SSD/MyWorkspace/github/iwsdk-phoenix-monorepo/iwsdk-plugin-phoenix/docs/FEASIBILITY.md), le SDK réel n'est pas `@meta/iwsdk` et n'utilise pas de classes TypeScript pour ses composants, mais **`@iwsdk/core`** fondé sur l'ECS **`elics`** avec stockage tabulaire par colonnes (`TypedArray`).

### 6.1. Définition des Composants Réels (`packages/client/src/components/`)

```ts
import { Types, createComponent } from '@iwsdk/core';

/**
 * Composant pour marquer les entités PNJs dotées d'une IA locale
 */
export const SmartNPC = createComponent(
  'SmartNPC',
  {
    /** Identifiant de la personnalité/archétype du PNJ */
    personalityId: { type: Types.Int32, default: 0 },
    /** Flag indiquant si l'IA est en train d'inférer */
    isThinking: { type: Types.Boolean, default: false },
    /** Timestamp du dernier déclenchement d'interaction */
    lastQueryTime: { type: Types.Float64, default: 0 },
  },
  'Intelligence locale WebGPU pour PNJ'
);

/**
 * Composant de Voix 3D Spatialisée
 */
export const SpatialVoice = createComponent(
  'SpatialVoice',
  {
    /** Distance de référence pour l'atténuation audio (mètres) */
    refDistance: { type: Types.Float32, default: 2.0 },
    /** Distance maximale d'audibilité */
    maxDistance: { type: Types.Float32, default: 25.0 },
    /** Hauteur de ton / pitch */
    pitch: { type: Types.Float32, default: 1.0 },
    /** Flag indiquant si le son est en cours de lecture */
    isPlaying: { type: Types.Boolean, default: false },
  },
  'Audio spatialisé 3D pour la voix du PNJ'
);
```

### 6.2. Implémentation du Système ECS Conforme (`CardinalIntelligenceSystem.ts`)

```ts
import { createSystem, System } from '@iwsdk/core';
import { Networked } from '../components';
import { SmartNPC } from '../components/SmartNPC';

export class CardinalIntelligenceSystem extends createSystem(
  {
    npcs: {
      all: [Networked, SmartNPC],
    },
  },
  {
    modelConfig: { type: 'object', default: {} },
  }
) {
  private gemmaWorker: Worker | null = null;
  private isModelReady = false;
  private pendingRequests = new Map<string, (response: string) => void>();

  public override init(): void {
    // Initialisation asynchrone du Web Worker WebGPU
    this.gemmaWorker = new Worker(
      new URL('../workers/gemma.worker.js', import.meta.url),
      { type: 'module' }
    );

    this.gemmaWorker.onmessage = (event: MessageEvent) => {
      const { type, payload } = event.data;
      if (type === 'MODEL_READY') {
        this.isModelReady = true;
      } else if (type === 'NPC_DECISION_RESULT') {
        const cb = this.pendingRequests.get(payload.requestId);
        if (cb) {
          cb(payload.text);
          this.pendingRequests.delete(payload.requestId);
        }
      }
    };

    this.gemmaWorker.postMessage({ type: 'LOAD_MODEL' });
  }

  public async queryNPC(networkId: number, playerSpeech: string, worldContext: string): Promise<string> {
    if (!this.isModelReady || !this.gemmaWorker) {
      return "Le PNJ reste silencieux...";
    }

    const requestId = `${networkId}_${Date.now()}`;
    return new Promise((resolve) => {
      this.pendingRequests.set(requestId, resolve);
      this.gemmaWorker!.postMessage({
        type: 'GENERATE_NPC_DECISION',
        payload: { requestId, networkId, playerSpeech, worldContext }
      });
    });
  }

  public override update(dt: number): void {
    // Boucle ECS tick
  }
}
```

---

## 7. Feuille de Route et Stratégie d'Implémentation Progressive

1. **Phase 1 : Validation Unitaire du Runtime WebGPU en Worker (Isolé)**
   - Valider `navigator.gpu` au sein d'un Web Worker dédié sur Meta Quest Browser (v146+).
   - Mesurer le temps d'allocation VRAM et la latence d'initialisation de WebLLM avec un mini-modèle (ex. SmolLM-135M / 360M INT4).

2. **Phase 2 : Profiling du Time-Slicing & Moniteur de Frame Drops**
   - Injecter une charge de calcul de tokens pendant une session WebXR active à 90 FPS.
   - Vérifier via OVR Metrics Tool que le framerate ne chute pas en dessous de 85 FPS lors de l'inférence.

3. **Phase 3 : Intégration Piper TTS & Audio Spatialisé Web Audio**
   - Implémenter le `tts.worker.ts` avec Piper WASM.
   - Valider le transfert zero-copy `Transferable` des `Float32Array` vers `THREE.PositionalAudio`.

4. **Phase 4 : Couplage avec les Composants Cardinal et le Backend Phoenix**
   - Injecter les composants de climat (`Weather`), d'heure de monde (`Clock.now_ms()`) et de secteur dans les prompts locaux de manière totalement synchrone et zéro coût réseau.

---

## 8. Conclusion

L'intégration de Gemma sur WebGPU et du TTS spatialisé local au sein de l'architecture Cardinal est **techniquement faisable sur Meta Quest 3 / Pro**, à condition absolue de :
1. **Choisir un modèle sous les 800 Mo - 1 Go en INT4** (ex. SmolLM-1.3B INT4, Gemma 2B quantisé 3/4-bit, ou Qwen2.5-0.5B/1.5B).
2. **Remplacer SpeechT5 par Piper WASM** pour garantir une synthèse instantanée en quelques centaines de millisecondes.
3. **Sanctuariser la boucle de rendu 90 FPS** via l'isolation en Web Worker et le découpage de calculs GPU (Time-Slicing).
4. **Appliquer une logique 100% événementielle** pour préserver la batterie et éviter tout thermal throttling.
