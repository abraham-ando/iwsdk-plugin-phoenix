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
