/**
 * The Cardinal component schema — the single source of truth.
 *
 * Everything replicated as component data is declared here once, and
 * `scripts/generate-cardinal.mjs` turns it into the client's ECS definitions,
 * the server's structs, both binary codecs, and the parity vectors that prove
 * the two agree. Editing a generated file instead of this one is caught by
 * `scripts/check-cardinal-drift.mjs` in `pnpm test`.
 *
 * Rules that are enforced, not merely suggested (see `validate.mjs`):
 *
 *   * `id` is a permanent wire identity. Never renumber, never recycle a
 *     removed id, never let file order imply it.
 *   * The type set is closed — see `types.mjs`. It holds only fixed-size
 *     types, which is what lets a wire record carry no length field.
 *   * Changing any of this changes the schema hash, and a client whose hash
 *     differs from the server's is refused at join.
 *
 * The two components below are the starting set: one trivially scalar, one
 * mixing an id with a vector, so every generated path has a live example.
 */
export const components = [
  {
    id: 1,
    name: 'Health',
    fields: [
      { name: 'current', type: 'f32' },
      { name: 'max', type: 'f32' },
    ],
  },
  {
    id: 2,
    name: 'Grabbable',
    fields: [
      /** Network id of the holder; 0 means nobody. */
      { name: 'holderId', type: 'u32' },
      /** Grab anchor in the entity's local space. */
      { name: 'grabPoint', type: 'vec3' },
    ],
  },
  {
    id: 3,
    name: 'Weather',
    fields: [
      /** 0 clear, 1 rain, 2 storm, 3 fog — see IwsdkPhoenix.World.Weather. */
      { name: 'kind', type: 'u8' },
      { name: 'intensity', type: 'f32' },
      { name: 'wind', type: 'vec3' },
    ],
  },
  {
    id: 4,
    name: 'CharacterGenome',
    fields: [
      // Un octet par gène — 256 pas sur [0,1], très en deçà du seuil de
      // perception sur une largeur d'épaules (spec §10.2 de la spec mère).
      // Ordre : l'ordre ALPHABÉTIQUE des clés de HUMANOID.genes, celui que
      // `createGenome()` applique déjà — ne pas en inventer un autre.
      { name: 'genes', type: 'array', of: 'u8', length: 13 },
    ],
  },
];
