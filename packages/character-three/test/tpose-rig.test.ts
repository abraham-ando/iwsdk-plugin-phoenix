/**
 * Contrat du rig sur un vrai GLB Ready Player Me : l'avatar T-pose masculin
 * de `readyplayerme/animation-library`, récupéré par `pnpm clips` (§ tâche 9
 * de l'étape 3). Sondé avant l'écriture de cette tâche : maillage skinné
 * unique `Wolf3D_Avatar`, 58 joints, 19/19 rôles d'os `HUMANOID` satisfaits,
 * ZÉRO morph target.
 *
 * Piège mesuré avant l'écriture de cette tâche, et délibérément évité ici :
 * `GLTFLoader` de Three ne parse PAS ce GLB en Node — il porte des textures,
 * et le chargeur réclame `self`, absent hors navigateur
 * (`ReferenceError: self is not defined`). Les clips d'animation de
 * `fixtures/realClip.ts` passent par ce chargeur uniquement parce qu'ils
 * n'ont aucune texture ; un avatar en a toujours.
 *
 * `resolveBinding` n'exige pourtant qu'un `RigNode` — un simple arbre
 * nom/enfants/position/quaternion (voir `src/resolve/types.ts`), pas un vrai
 * graphe `Object3D`. On lit donc le chunk JSON du conteneur GLB directement,
 * sans passer par Three ni par un navigateur.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { resolveBinding } from '../src/resolve/resolveBinding';
import type { RigNode, ImportReport } from '../src/resolve/types';

const DIR = join(__dirname, '../../../apps/demo/public/characters');
const MASCULINE = 'avatar-tpose-masculine.glb';

function avatarAvailable(): boolean {
  return existsSync(join(DIR, MASCULINE));
}

/**
 * Message de saut BRUYANT, comme `root-motion.test.ts` : un test qui se
 * saute en silence ne prouve rien.
 */
const SKIP_REASON =
  'avatars T-pose absents — lancer `pnpm clips` (récupérés avec les clips ' +
  "d'animation, même règle de licence : usage autorisé, redistribution " +
  'interdite)';

/** Un nœud brut du tableau `nodes` d'un document glTF 2.0. */
interface GltfRawNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
  readonly mesh?: number;
}

interface GltfMesh {
  readonly primitives: ReadonlyArray<{ readonly targets?: readonly unknown[] }>;
  readonly extras?: { readonly targetNames?: readonly string[] };
}

interface GltfDocument {
  readonly nodes: readonly GltfRawNode[];
  readonly meshes?: readonly GltfMesh[];
  readonly scene?: number;
  readonly scenes?: ReadonlyArray<{ readonly nodes: readonly number[] }>;
}

/**
 * Lit le chunk JSON d'un fichier GLB. Format binaire glTF 2.0 : douze octets
 * d'en-tête (magic, version, longueur totale), puis une suite de chunks
 * longueur/type/données ; le premier chunk est toujours le JSON.
 */
function readGltfJson(path: string): GltfDocument {
  const buffer = readFileSync(path);
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON', petit-boutiste
  if (chunkType !== JSON_CHUNK_TYPE) {
    throw new Error(
      `${path} : premier chunk GLB inattendu (0x${chunkType.toString(16)}), JSON espéré`,
    );
  }
  const json = buffer.subarray(20, 20 + chunkLength).toString('utf8');
  return JSON.parse(json) as GltfDocument;
}

/**
 * Reconstruit l'arbre `RigNode` que `resolveBinding` attend, à partir des
 * nœuds bruts du document glTF. Un maillage porteur de morph targets
 * recevrait un `morphTargetDictionary` — cette branche reste inexercée sur
 * ces deux avatars (zéro morph target mesuré), mais elle évite que ce test
 * mente par omission si un avatar RPM en apportait un jour.
 */
function toRigNode(doc: GltfDocument, index: number): RigNode {
  const raw = doc.nodes[index];
  if (raw === undefined) throw new Error(`nœud glTF ${index} absent du document`);
  const [x, y, z] = raw.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = raw.rotation ?? [0, 0, 0, 1];
  const children = (raw.children ?? []).map((childIndex) => toRigNode(doc, childIndex));

  let morphTargetDictionary: Record<string, number> | undefined;
  if (raw.mesh !== undefined) {
    const mesh = doc.meshes?.[raw.mesh];
    const targets = mesh?.primitives[0]?.targets;
    if (targets !== undefined && targets.length > 0) {
      const names = mesh?.extras?.targetNames ?? targets.map((_, i) => `morph_${i}`);
      const dict: Record<string, number> = {};
      names.forEach((name, i) => {
        dict[name] = i;
      });
      morphTargetDictionary = dict;
    }
  }

  return {
    name: raw.name ?? `node_${index}`,
    children,
    position: { x, y, z },
    quaternion: { x: qx, y: qy, z: qz, w: qw },
    ...(morphTargetDictionary ? { morphTargetDictionary } : {}),
  };
}

/** Racine `RigNode` de la scène par défaut d'un GLB local. */
function loadRigRoot(fileName: string): RigNode {
  const doc = readGltfJson(join(DIR, fileName));
  const rootIndices = doc.scenes?.[doc.scene ?? 0]?.nodes ?? [0];
  const first = rootIndices[0];
  if (rootIndices.length === 1 && first !== undefined) return toRigNode(doc, first);
  // Racine synthétique si la scène déclare plusieurs racines : `resolveBinding`
  // n'accepte qu'un seul `RigNode` de départ, mais parcourt tout descendant —
  // ce nœud n'a lui-même aucun rôle et ne fausse donc rien.
  return {
    name: '__scene_root__',
    children: rootIndices.map((i) => toRigNode(doc, i)),
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
}

const available = avatarAvailable();
const maybe = available ? describe : describe.skip;
if (!available) console.warn(`\n⚠️  tpose-rig.test.ts SAUTÉ : ${SKIP_REASON}\n`);

maybe('resolveBinding — avatar T-pose masculin réel (readyplayerme/animation-library)', () => {
  let report: ImportReport;

  beforeAll(() => {
    const root = loadRigRoot(MASCULINE);
    report = resolveBinding(HUMANOID, root, 1.8).report;
  });

  it("les 19 rôles d'os HUMANOID sont tous satisfaits — le rig est accepté", () => {
    expect(report.missingBones).toEqual([]);
  });

  it("le rapport dit la vérité : zéro morph target mesuré, missingMorphs n'est PAS vide", () => {
    // L'essentiel du test : un rapport qui prétendrait que tout va bien
    // serait pire qu'un rig incomplet. Les cinq gènes de visage de HUMANOID
    // (jawWidth, noseSize, eyeScale, cheekbone, bodyMass) n'ont aucun
    // dictionnaire de morphs où se poser — ce GLB n'en porte aucun.
    expect(report.missingMorphs.length).toBeGreaterThan(0);
  });

  it('le rapport dit la vérité : maillage unique "Wolf3D_Avatar", missingSurfaces n\'est PAS vide', () => {
    // Ni `Wolf3D_Body` ni `Wolf3D_Hair` (les seuls alias de HUMANOID.surfaces)
    // ne désignent ce maillage : aucune cible de teinte n'existe sur ce rig.
    expect(report.missingSurfaces.length).toBeGreaterThan(0);
  });
});
