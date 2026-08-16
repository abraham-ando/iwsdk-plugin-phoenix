/**
 * Procedural Environment Ground Scene Asset Prototype.
 * Exports the procedural terrain mesh prototype for the IWSDK Scene Loader and Locomotor BVH engine.
 * Keeping a single mesh ensures Three.js BufferGeometryUtils.mergeGeometries succeeds flawlessly.
 */

import { ProceduralTerrain } from '../simulation/ProceduralTerrain';

const terrain = ProceduralTerrain.createTerrain();
const environmentGround = terrain.mesh;
environmentGround.name = 'Environment Ground Prototype';

export default environmentGround;
