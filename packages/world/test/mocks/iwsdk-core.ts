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

// --- Géométrie : de quoi construire et inspecter une tuile ---------------
// Implémentation minimale mais FIDÈLE des accesseurs utilisés par le code.

export class BufferAttribute {
  constructor(
    public array: Float32Array | Uint32Array,
    public itemSize: number,
  ) {}
  get count(): number {
    return this.array.length / this.itemSize;
  }
  getX(i: number): number {
    return this.array[i * this.itemSize] as number;
  }
  getY(i: number): number {
    return this.array[i * this.itemSize + 1] as number;
  }
  getZ(i: number): number {
    return this.array[i * this.itemSize + 2] as number;
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: Float32Array | number[], itemSize: number) {
    super(array instanceof Float32Array ? array : new Float32Array(array), itemSize);
  }
}

export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array: Uint32Array | number[], itemSize: number) {
    super(array instanceof Uint32Array ? array : new Uint32Array(array), itemSize);
  }
}

export class BufferGeometry {
  private attrs = new Map<string, BufferAttribute>();
  private index: BufferAttribute | null = null;
  public disposed = false;
  public boundingSphere: unknown = null;
  setAttribute(name: string, attribute: BufferAttribute): this {
    this.attrs.set(name, attribute);
    return this;
  }
  getAttribute(name: string): BufferAttribute {
    const a = this.attrs.get(name);
    if (a === undefined) throw new Error(`missing attribute ${name}`);
    return a;
  }
  setIndex(attribute: BufferAttribute): this {
    this.index = attribute;
    return this;
  }
  getIndex(): BufferAttribute | null {
    return this.index;
  }
  computeVertexNormals(): void {
    // Le mock ne calcule rien : les tests d'orientation lisent les positions
    // et l'index, pas les normales que Three produirait.
    const position = this.attrs.get('position');
    if (position !== undefined && !this.attrs.has('normal')) {
      this.setAttribute('normal', new Float32BufferAttribute(new Float32Array(position.count * 3), 3));
    }
  }
  computeBoundingSphere(): void {
    this.boundingSphere = { radius: 1 };
  }
  dispose(): void {
    this.disposed = true;
  }
}

class Vec3Like {
  public x = 0;
  public y = 0;
  public z = 0;
  set(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class Mesh {
  public name = '';
  public castShadow = false;
  public receiveShadow = false;
  public position = new Vec3Like();
  constructor(
    public geometry: BufferGeometry,
    public material: unknown,
  ) {}
}

export const LocomotionEnvironment = createComponent(
  'LocomotionEnvironment',
  {
    type: { type: Types.String, default: 'static' },
    _envHandle: { type: Types.Float32, default: 0 },
    _initialized: { type: Types.Boolean, default: false },
  },
  'Locomotion environment',
);

// --- Matériaux à nuanceur --------------------------------------------------

export const DoubleSide = 2;

export class Color {
  public r = 1;
  public g = 1;
  public b = 1;
  constructor(hex = 0xffffff) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
  }
  setRGB(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
}

export class ShaderMaterial {
  public uniforms: Record<string, { value: unknown }> = {};
  public vertexShader = '';
  public fragmentShader = '';
  public transparent = false;
  public side = 0;
  public depthWrite = true;
  public disposed = false;
  constructor(parameters: Record<string, unknown> = {}) {
    Object.assign(this, parameters);
  }
  dispose(): void {
    this.disposed = true;
  }
}
