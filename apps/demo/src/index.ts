/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World, type Entity } from '@iwsdk/core';
import { CharacterGenome, installPhoenixNetworking, Networked } from '@iwsdk/plugin-phoenix';
import projectOptions from 'virtual:iwsdk-project';
import { DemoHud } from './hud.js';
import { MultiplayerSystem } from './multiplayer.js';
import { describeConfig, readNetworkConfig } from './networking.js';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';
import { setupCardinalVillage } from './ai-village.js';
import { installCardinalWorld } from '@iwsdk/cardinal-world';
import { CardinalSimulationSystem } from './simulation/CardinalSimulationSystem.js';
import { PrehistoricEnvironment3D } from './simulation/PrehistoricEnvironment3D.js';
import { VILLAGE_LAYOUT } from './simulation/layout.js';
import { SimulationHud } from './simulation/simulation-hud.js';
import { Mode2Client } from './simulation/Mode2Client.js';
import { mountLocalAiPanel } from './simulation/mountLocalAiPanel.js';
import { PlayerMicrophone } from './simulation/PlayerMicrophone.js';
import { TrajectoryUploader } from './simulation/TrajectoryUploader.js';
import { PhysicsSimulationSystem } from './simulation/PhysicsSimulationSystem.js';
import {
  createCharacterFromAsset,
  genomeToBytes,
  installCharacterThree,
  loadCharacterClips,
} from '@iwsdk/cardinal-character-three';
import { installCharacterUI } from '@iwsdk/cardinal-character-ui';
import { buildVillagerGenomes } from './simulation/villagerGenomes.js';
import { makeRiggedBody, upgradeVillagers } from './simulation/VillagerBody.js';
import { VILLAGER_NETWORK_IDS } from './simulation/villagerNetworkIds.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const network = readNetworkConfig(import.meta.env);

// Built before the world, not inside the `then`: the scene streams its models
// from a CDN, and when that fails this readout is the only thing left to say
// what happened.
const hud = new DemoHud(document.body, { target: describeConfig(network) });

World.create(container, projectOptions)
  .then((world) => {
    // Priorités explicites, bande 50-58, en amont des personnages (60).
    world.registerSystem(RobotSystem, { priority: 50 });
    world.registerSystem(PanelSystem, { priority: 52 });
    world.registerSystem(PhysicsSimulationSystem, { priority: 54 });

    // 1. Mount Cardinal AI Engine, NPCs & Interactive HUD
    setupCardinalVillage(world);

    // 2a. Mount the procedural environment package (sky rig, quality tiers)
    const { quality, materials, colorManaged, terrain } = installCardinalWorld(world, {
      latitudeDeg: 45,
    });
    console.log(`[demo] environment quality tier: ${quality}, colour managed: ${colorManaged}`);
    // Le sol n'est plus un maillage de 64 m posé dans la scène : il est streamé
    // en tuiles autour du joueur. Le compte est lu APRÈS la première frame —
    // au moment de l'installation il vaut forcément zéro, ce qui n'apprend rien.
    queueMicrotask(() => {
      setTimeout(() => {
        console.log(
          `[demo] terrain: ${terrain.streaming.pendingCount} tiles streamed, ` +
            `${terrain.mesh.builtCount} built`,
        );
      }, 2000);
    });

    // 2. Mount the Cardinal simulation engine + its VR projection & HUD
    world.registerSystem(CardinalSimulationSystem, { priority: 58 });
    const simSystem = world.getSystem(CardinalSimulationSystem);
    if (simSystem) {
      const sceneData = PrehistoricEnvironment3D.createWorldScene(world, VILLAGE_LAYOUT, materials);
      (world as any).scene?.add?.(sceneData.root);
      simSystem.attachScene(sceneData);

      // Le paquet des personnages n'était branché nulle part : l'étape 2 avait
      // livré des composants et des systèmes que l'application n'importait pas.
      installCharacterThree(world);

      // Le village est monté en marionnettes et JOUABLE dès cette frame. Les
      // rigs le remplacent ensuite, un par un, si le réseau les apporte.
      const genomes = buildVillagerGenomes(VILLAGE_LAYOUT.agents);
      // Le pont entité → agent, et entité → gènes inertes : remplis dans
      // `buildRig`, où l'entité est connue en même temps que l'agent et que
      // le `ImportReport` que `createCharacterFromAsset` rend déjà. Le
      // panneau de personnage les consomme par injection — voir
      // `installCharacterUI` plus bas — pour ne jamais dépendre lui-même de
      // `@iwsdk/cardinal-simulation`.
      const agentIdParEntite = new Map<Entity, string>();
      const rapportsParEntite = new Map<Entity, ReadonlySet<string>>();
      // Une seule chaîne, pas deux indépendantes : un échec des clips
      // FÉMININS annule aussi les rigs MASCULINS (le .catch du bas couvre
      // tout). Asymétrie acceptée pour rester simple — le village entier
      // retombe en marionnettes plutôt que de mélanger rigs et marionnettes
      // par genre.
      void loadCharacterClips({
        idle: 'clip-idle-masculine',
        walk: 'clip-walk-masculine',
      })
        .then((masculineClips) =>
          loadCharacterClips({ idle: 'clip-idle-feminine', walk: 'clip-walk-feminine' }).then(
            (feminineClips) =>
              upgradeVillagers({
                bodies: sceneData.agentAvatars,
                agents: VILLAGE_LAYOUT.agents,
                buildRig: async (agent, puppet) => {
                  // Un seul asset de base par genre : sept villageois
                  // masculins partagent `avatar-tpose-masculine`, quatre
                  // féminines `avatar-tpose-feminine`. Ce qui les distingue
                  // à l'écran est la morphologie compilée, pas le fichier.
                  const assetId =
                    agent.gender === 'feminine'
                      ? 'avatar-tpose-feminine'
                      : 'avatar-tpose-masculine';
                  const { entity, report } = await createCharacterFromAsset(world, {
                    assetId,
                    familyId: 'humanoid',
                    genome: genomes[agent.id]!,
                    age: 30,
                  });
                  agentIdParEntite.set(entity, agent.id);
                  // Identité réseau fixe (patron adoptSharedPlant) : chaque
                  // pair crée ce personnage localement et de façon
                  // identique, il ne lui manque qu'un networkId connu
                  // d'avance. Le composant CharacterGenome se publie et se
                  // reçoit ENTIÈREMENT SEUL une fois posé — CardinalPublisher
                  // et PhoenixNetworkSystem font le reste, aucun appel
                  // explicite de publication.
                  // `villager-network-ids.test.ts` prouve que
                  // VILLAGER_NETWORK_IDS couvre exactement les onze agents
                  // de DEFAULT_VILLAGE, dont VILLAGE_LAYOUT.agents est un
                  // alias direct (layout.ts) — cette branche ne devrait donc
                  // jamais s'exercer en pratique. On préfère quand même ne
                  // jamais écrire un networkId 0 (sentinelle invalide côté
                  // protocole) : un agent sans identifiant connu reste un
                  // personnage purement local, ni Networked ni répliqué,
                  // plutôt que de mentir sur son identité réseau.
                  const networkId = VILLAGER_NETWORK_IDS[agent.id];
                  if (networkId === undefined) {
                    console.warn(
                      `[villagers] identifiant réseau manquant pour l'agent "${agent.id}" — Networked/CharacterGenome non posés.`,
                    );
                  } else {
                    entity.addComponent(Networked, {
                      networkId,
                      isLocalOwner: false,
                      ownerId: 0,
                    });
                    entity.addComponent(CharacterGenome, {
                      genes: genomeToBytes(genomes[agent.id]!),
                    });
                  }
                  rapportsParEntite.set(
                    entity,
                    new Set([...report.missingMorphs, ...report.missingSurfaces]),
                  );
                  return makeRiggedBody(
                    world, entity,
                    agent.gender === 'feminine' ? feminineClips : masculineClips,
                    puppet,
                  );
                },
              }),
          ),
        )
        .catch((error: unknown) => {
          console.warn('[cardinal-demo] clips indisponibles, village en marionnettes :', error);
        });

      // Le panneau de personnage : viser un villageois, régler ses gènes,
      // lire son état mental. Lancé sans attendre le basculement des rigs
      // ci-dessus — les deux Map qu'il consomme se remplissent au fil de
      // `buildRig`, et le panneau les relit à chaque sélection plutôt qu'à
      // l'installation.
      void installCharacterUI(world, {
        // Le pont entité → agent : seule la démo le connaît, sa carte étant
        // clavée par identifiant. C'est pourquoi le paquet ne dépend pas de
        // `cardinal-simulation`.
        persona: (entity) => {
          const id = agentIdParEntite.get(entity);
          if (id === undefined) return null;
          const etat = simSystem.runtime.agents.get(id);
          if (etat === undefined) return null;
          return {
            name: etat.profile.name,
            tribe: etat.profile.tribe,
            role: etat.profile.role,
            persona: etat.profile.persona ?? null,
            needs: etat.needs,
            action: etat.currentAction?.verb ?? null,
            plan: etat.plan.map((p) => p.goal),
          };
        },
        inertGenes: (entity) => rapportsParEntite.get(entity) ?? new Set<string>(),
      }).catch((error: unknown) => {
        // Le panneau est un confort : son absence ne doit jamais empêcher le
        // monde de tourner.
        console.warn('[cardinal-demo] panneau de personnage indisponible :', error);
      });

      const microphone = new PlayerMicrophone(world, (text) => simSystem.playerSpeak(text));
      new SimulationHud(document.body, simSystem, microphone);
      // Mode-2 deliberation: pump plan requests to the BFF (LLM or mock), with
      // a local WebGPU model as second tier once someone activates it.
      const mode2 = new Mode2Client(simSystem);
      // Sonde de contention GPU, sur demande explicite : elle télécharge un
      // modèle et mesure ce qu'une génération coûte au temps d'image.
      const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
      if (new URLSearchParams(location.search).has('probe-gpu') || env.VITE_PROBE_GPU) {
        void import('./simulation/GpuContentionProbe.js').then((m) =>
          m.runGpuContentionProbe(mode2)
        );
      }
      // Sonde de budget de frame, sur demande explicite (TS-B1) : échantillonne
      // le temps de frame p50/p95/p99 en continu, sans dépendance à Mode2Client.
      if (new URLSearchParams(location.search).has('probe-frame') || env.VITE_PROBE_FRAME) {
        void import('./simulation/FrameBudgetProbe.js').then((m) => m.runFrameBudgetProbe());
      }
      // Dataset capture: ship recorded trajectories to the BFF periodically.
      new TrajectoryUploader(simSystem);
      // Panneau d'activation de l'IA locale, posé devant le point d'apparition.
      void mountLocalAiPanel(world, mode2);
    }

    // Registers the plugin's components and its four systems, and starts
    // connecting. Offline is a real adapter rather than a flag, so every system
    // runs exactly the same code path with or without a server.
    const net = installPhoenixNetworking(world, {
      endpoint: network.endpoint,
      roomId: network.roomId,
      mode: network.mode,
      isOffline: network.isOffline,
      moveSpeed: network.moveSpeed,
    });

    // Registered before `ready` resolves on purpose: the system has to be live
    // to receive the spawn frames the server sends immediately after the join,
    // which are how it learns about everyone already in the room.
    // Priorité 56, dans la même bande 50-58 que les autres systèmes du demo.
    // Sans elle, elics lui donnait le 0 implicite : elle tournait AVANT
    // l'atmosphère, le terrain et la simulation, alors qu'elle tournait après
    // tout le monde avant que les priorités ne soient déclarées.
    world.registerSystem(MultiplayerSystem, { priority: 56, configData: { net, hud } });

    net.ready.catch((error: unknown) => {
      // A refused join must not take the scene down with it — single player is
      // still a perfectly good thing to be looking at.
      console.error('[demo] could not join the room:', error);
      hud.setConnection('errored', 0);
    });
  })
  .catch((error: unknown) => {
    console.error('[demo] world failed to start:', error);
    hud.setStatus('world failed to start — see the console');
  });
