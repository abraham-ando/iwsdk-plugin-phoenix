/**
 * Pose le panneau d'IA locale dans le monde et lui donne sa logique.
 *
 * Instancié par le code plutôt que placé dans la scène : le panneau n'a de
 * sens que si le moteur de simulation tourne, et sa position se déduit du
 * point d'apparition du joueur, que la scène fixe déjà.
 */
import { UIKitMLAsset, type World } from '@iwsdk/core';
import { LocalAiPanel, type PanelDocument } from './LocalAiPanel';
import type { Mode2Client } from './Mode2Client';

/** Devant le joueur, à hauteur de regard, tourné vers lui. */
const POSITION: readonly [number, number, number] = [1.35, 7.1, -1.15];
const ROTATION_Y = Math.PI; // les surfaces UIKitML sont à face unique

export async function mountLocalAiPanel(
  world: World,
  client: Mode2Client
): Promise<LocalAiPanel | null> {
  try {
    const panel = await world.assets.instantiate<UIKitMLAsset>('local-ai-panel');
    const object = panel as unknown as {
      position: { set(x: number, y: number, z: number): void };
      rotation: { y: number };
      scale: { setScalar(v: number): void };
    };
    object.position.set(POSITION[0], POSITION[1], POSITION[2]);
    object.rotation.y = ROTATION_Y;
    object.scale.setScalar(0.5);
    world.createTransformEntity(panel);

    const controller = new LocalAiPanel(
      panel as unknown as PanelDocument,
      client,
      () => world.xrSession != null
    );
    return controller;
  } catch (err) {
    // Le panneau est un confort : son absence ne doit jamais empêcher le monde
    // de tourner, ni la délibération distante de fonctionner.
    console.warn('[mountLocalAiPanel] panneau indisponible', err);
    return null;
  }
}
