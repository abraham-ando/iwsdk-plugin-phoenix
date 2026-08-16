/**
 * Headless stand-in for `@iwsdk/core`, aliased in at test time only.
 * Re-exports the genuine `elics` ECS runtime and reproduces the IWSDK
 * environment components our systems write into.
 */
export {
  ComponentRegistry,
  Types,
  World,
  createComponent,
  createSystem,
  eq,
  ge,
  gt,
  isin,
  le,
  lt,
  ne,
  nin,
} from 'elics';
export type { AnyComponent, Entity } from 'elics';

import { Types, createComponent } from 'elics';

export const Transform = createComponent(
  'Transform',
  {
    position: { type: Types.Vec3, default: [0, 0, 0] },
    orientation: { type: Types.Vec4, default: [0, 0, 0, 1] },
    scale: { type: Types.Vec3, default: [1, 1, 1] },
    parent: { type: Types.Entity, default: null },
  },
  'Local transform',
);

// Schemas are declared inline rather than shared through a variable: passing
// one through a `const` widens `Types.Color` to `Types` and breaks
// createComponent's inference. IWSDK declares these two the same way.
export const DomeGradient = createComponent(
  'DomeGradient',
  {
    sky: { type: Types.Color, default: [0.5, 0.7, 1, 1] },
    equator: { type: Types.Color, default: [0.8, 0.85, 0.9, 1] },
    ground: { type: Types.Color, default: [0.3, 0.28, 0.25, 1] },
    intensity: { type: Types.Float32, default: 1 },
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Sky dome',
);

export const IBLGradient = createComponent(
  'IBLGradient',
  {
    sky: { type: Types.Color, default: [0.5, 0.7, 1, 1] },
    equator: { type: Types.Color, default: [0.8, 0.85, 0.9, 1] },
    ground: { type: Types.Color, default: [0.3, 0.28, 0.25, 1] },
    intensity: { type: Types.Float32, default: 1 },
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Environment IBL',
);

// --- Minimal Three stubs -------------------------------------------------
// The library only needs these to exist and to record what was assigned;
// the pixel logic itself lives in pure functions and is tested directly.

export const SRGBColorSpace = 'srgb';
export const NoColorSpace = '';
export const RepeatWrapping = 1000;
export const RGBAFormat = 1023;
export const UnsignedByteType = 1009;
export const ACESFilmicToneMapping = 4;

export class DataTexture {
  public needsUpdate = false;
  public colorSpace = '';
  public wrapS = 0;
  public wrapT = 0;
  public disposed = false;
  constructor(
    public data: Uint8Array,
    public width: number,
    public height: number,
    public format?: number,
    public type?: number,
  ) {}
  dispose(): void {
    this.disposed = true;
  }
}

export class MeshStandardMaterial {
  public map: DataTexture | null = null;
  public normalMap: DataTexture | null = null;
  public roughnessMap: DataTexture | null = null;
  public metalnessMap: DataTexture | null = null;
  public aoMap: DataTexture | null = null;
  public vertexColors = false;
  public roughness = 1;
  public metalness = 0;
  public disposed = false;
  constructor(parameters: Record<string, unknown> = {}) {
    Object.assign(this, parameters);
  }
  dispose(): void {
    this.disposed = true;
  }
}
