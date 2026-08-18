/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;
const DEFAULT_STOCK_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets';
const configuredStockAssetBase =
  import.meta.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL?.trim();
const stockAssetBase = (
  configuredStockAssetBase || DEFAULT_STOCK_ASSET_BASE
).replace(/\/+$/u, '');

function stockAssetUrl(assetId: string, fileName: string): string {
  return `${stockAssetBase}/${assetId}/${fileName}`;
}

export default defineAssets({
  // Procedural Environment Ground with Walkable Surface
  // Ready Player Me Real Humanoid Avatars
  'avatar-eldrin': {
    url: 'https://models.readyplayer.me/6460d3219d050a41d0ec2048.glb',
    type: AssetType.GLTF,
    name: 'Eldrin Mage Avatar (RPM)',
    priority: 'lazy',
  },
  'avatar-garrick': {
    url: 'https://models.readyplayer.me/6460d35a9d050a41d0ec2069.glb',
    type: AssetType.GLTF,
    name: 'Garrick Guard Avatar (RPM)',
    priority: 'lazy',
  },
  'avatar-sylvia': {
    url: 'https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb',
    type: AssetType.GLTF,
    name: 'Sylvia Merchant Avatar (RPM)',
    priority: 'lazy',
  },
  'avatar-haran': {
    url: 'https://models.readyplayer.me/6460d39e9d050a41d0ec209d.glb',
    type: AssetType.GLTF,
    name: 'Haran Father Avatar (RPM)',
    priority: 'lazy',
  },
  'avatar-mira': {
    url: 'https://models.readyplayer.me/6460d37e9d050a41d0ec2085.glb',
    type: AssetType.GLTF,
    name: 'Mira Mother Avatar (RPM)',
    priority: 'lazy',
  },

  // Clips d'animation Ready Player Me. Les fichiers sont récupérés par
  // `pnpm clips` et ne sont pas dans le dépôt : leur licence interdit la
  // redistribution. Absents, la démo reste en marionnettes.
  'clip-idle-masculine': {
    url: publicAssetUrl('characters/idle-masculine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Idle (masculine rig)',
    priority: 'lazy',
  },
  'clip-idle-feminine': {
    url: publicAssetUrl('characters/idle-feminine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Idle (feminine rig)',
    priority: 'lazy',
  },
  'clip-walk-masculine': {
    url: publicAssetUrl('characters/walk-masculine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Walk (masculine rig)',
    priority: 'lazy',
  },
  'clip-walk-feminine': {
    url: publicAssetUrl('characters/walk-feminine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Walk (feminine rig)',
    priority: 'lazy',
  },

  // Avatars T-pose Ready Player Me, récupérés par `pnpm clips` et absents du
  // dépôt (licence : usage autorisé, redistribution interdite). Ce sont les
  // seuls rigs joignables : `models.readyplayer.me` ne résout pas ici.
  'avatar-tpose-masculine': {
    url: publicAssetUrl('characters/avatar-tpose-masculine.glb'),
    type: AssetType.GLTF,
    name: 'RPM T-Pose (masculine)',
    priority: 'lazy',
  },
  'avatar-tpose-feminine': {
    url: publicAssetUrl('characters/avatar-tpose-feminine.glb'),
    type: AssetType.GLTF,
    name: 'RPM T-Pose (feminine)',
    priority: 'lazy',
  },

  // Interactive Props & UI
  'plant-sansevieria': {
    url: stockAssetUrl('plant-sansevieria', 'plantSansevieria.gltf'),
    type: AssetType.GLTF,
    name: 'Plant Sansevieria',
    priority: 'lazy',
  },
  robot: {
    url: stockAssetUrl('robot', 'robot.gltf'),
    type: AssetType.GLTF,
    name: 'Robot',
    priority: 'lazy',
  },
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    name: 'Welcome Panel',
  },
  'local-ai-panel': {
    url: publicAssetUrl('ui/local-ai.uikitml'),
    type: AssetType.UIKitML,
    name: 'Local AI Panel',
  },
  'character-panel': {
    url: publicAssetUrl('ui/character.uikitml'),
    type: AssetType.UIKitML,
    name: 'Panneau de personnage',
    priority: 'lazy',
  },
});

