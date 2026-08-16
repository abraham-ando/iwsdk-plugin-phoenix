/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import { installPhoenixNetworking } from '@iwsdk/plugin-phoenix';
import projectOptions from 'virtual:iwsdk-project';
import { DemoHud } from './hud.js';
import { MultiplayerSystem } from './multiplayer.js';
import { describeConfig, readNetworkConfig } from './networking.js';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';
import { setupCardinalVillage } from './ai-village.js';
import { CardinalSimulationSystem } from './simulation/CardinalSimulationSystem.js';
import { PrehistoricEnvironment3D } from './simulation/PrehistoricEnvironment3D.js';
import { VILLAGE_LAYOUT } from './simulation/layout.js';
import { SimulationHud } from './simulation/simulation-hud.js';
import { Mode2Client } from './simulation/Mode2Client.js';
import { TrajectoryUploader } from './simulation/TrajectoryUploader.js';
import { PhysicsSimulationSystem } from './simulation/PhysicsSimulationSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const network = readNetworkConfig(import.meta.env);

// Built before the world, not inside the `then`: the scene streams its models
// from a CDN, and when that fails this readout is the only thing left to say
// what happened.
const hud = new DemoHud(document.body, { target: describeConfig(network) });

World.create(container, projectOptions)
  .then((world) => {
    world.registerSystem(RobotSystem);
    world.registerSystem(PanelSystem);
    world.registerSystem(PhysicsSimulationSystem);

    // 1. Mount Cardinal AI Engine, NPCs & Interactive HUD
    setupCardinalVillage(world);

    // 2. Mount the Cardinal simulation engine + its VR projection & HUD
    world.registerSystem(CardinalSimulationSystem);
    const simSystem = world.getSystem(CardinalSimulationSystem);
    if (simSystem) {
      const sceneData = PrehistoricEnvironment3D.createWorldScene(world, VILLAGE_LAYOUT);
      (world as any).scene?.add?.(sceneData.root);
      simSystem.attachScene(sceneData);
      new SimulationHud(document.body, simSystem);
      // Mode-2 deliberation: pump plan requests to the BFF (LLM or mock).
      new Mode2Client(simSystem);
      // Dataset capture: ship recorded trajectories to the BFF periodically.
      new TrajectoryUploader(simSystem);
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
    world.registerSystem(MultiplayerSystem, { configData: { net, hud } });

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
