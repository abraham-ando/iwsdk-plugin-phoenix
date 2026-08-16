# Environnement procédural ECS — Phase 1 : socle `packages/world` + rig ciel/lumière — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer le paquet `@iwsdk/cardinal-world` (composants et systèmes ECS, service de qualité) et y faire passer, comme première charge utile, un **rig ciel/lumière physique** : position solaire réelle, diffusion atmosphérique approchée, dôme et éclairage image-based pilotés par l'heure de la simulation — en supprimant `CelestialVisuals.ts`.

**Architecture:** Toute la logique vit dans des **fonctions pures testables** (position solaire, couleurs du ciel) ; les systèmes ECS ne sont que de minces adaptateurs qui écrivent le résultat dans les primitives natives d'IWSDK `DomeGradient` et `IBLGradient`, posées sur la racine du niveau, plus une lumière directionnelle solaire. La régénération de l'IBL est étranglée (coûteuse : elle produit un PMREM).

**Tech Stack:** TypeScript strict, vitest 3, tsup 8, `@iwsdk/core` en peer dependency, elics (via le mock de test), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (sections 3, 4, 11 phase 1)

## Global Constraints

- `packages/world` déclare `@iwsdk/core` en **peerDependency** et n'importe **jamais** `three` directement — l'override `three: npm:super-three@0.181.0` et le garde-fou `scripts/check-single-three.mjs` doivent rester verts.
- Le paquet suit le patron de `packages/ai` : composants via `createComponent(nom, schéma, description)`, systèmes via `createSystem({ requêtes }, { config })`, config lue en `this.config.clé.value`, installation par une fonction `installCardinalWorld(world, options)`.
- **Toute la logique calculatoire est en fonctions pures**, testées sans GPU ni navigateur. Les systèmes ne font qu'appliquer.
- `DomeGradient` et `IBLGradient` ne fonctionnent **que sur la racine du niveau** (`world.activeLevel`) — posés ailleurs, ils sont silencieusement ignorés.
- Après avoir écrit dans un composant d'environnement, lever `_needsUpdate` — sinon le changement est ignoré.
- Ne jamais allouer dans `update()` : vecteurs et couleurs pré-alloués en propriétés dans `init()`.
- Messages de commit `feat(...)`/`refactor(...)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Écart assumé vis-à-vis de la spec §4 :** le composant `SkyModel` ne déclare **pas** `rayleigh`, `mieCoefficient` ni `mieDirectionalG` en phase 1. Le modèle approché de cette phase ne les consomme pas, et déclarer des paramètres morts induirait en erreur. Ils seront ajoutés quand le modèle raffiné les utilisera.

---

## Structure de fichiers cible

```text
packages/world/
├── package.json            @iwsdk/cardinal-world, peer @iwsdk/core
├── tsconfig.json           extends ../../tsconfig.base.json
├── tsup.config.ts          entrée src/index.ts, ESM, platform browser, externals
├── vitest.config.ts        alias @iwsdk/core -> test/mocks/iwsdk-core.ts
├── src/
│   ├── index.ts            exports publics + installCardinalWorld
│   ├── core/quality.ts     QualityTier, detectQuality (pur)
│   ├── atmosphere/
│   │   ├── solar.ts        solarPosition (pur)
│   │   ├── skyColors.ts    skyAppearance (pur)
│   │   ├── components.ts   CelestialTime, SkyModel, StarField
│   │   ├── CelestialTimeSystem.ts
│   │   ├── SkyRenderSystem.ts
│   │   └── StarFieldSystem.ts
│   └── install.ts          installCardinalWorld + withLevelRoot
└── test/
    ├── mocks/iwsdk-core.ts stub elics + Transform + DomeGradient + IBLGradient
    ├── quality.test.ts  solar.test.ts  sky-colors.test.ts
    └── atmosphere-systems.test.ts

Modifiés :
├── package.json (racine)                       filtres build/test/typecheck
├── apps/demo/package.json                      + dépendance workspace
├── apps/demo/src/index.ts                      installCardinalWorld
├── apps/demo/src/simulation/CardinalSimulationSystem.ts   écrit l'heure/météo
└── apps/demo/src/simulation/CelestialVisuals.ts           SUPPRIMÉ
```

---

### Task 1 : Squelette du paquet et service de qualité

**Files:**
- Create: `packages/world/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- Create: `packages/world/src/core/quality.ts`, `packages/world/src/index.ts`
- Create: `packages/world/test/mocks/iwsdk-core.ts`
- Modify: `package.json` (racine — scripts `build`, `test`, `typecheck`)
- Test: `packages/world/test/quality.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces : `type QualityTier = 'low' | 'high'` ; `interface QualityEnv { userAgent?: string; deviceMemory?: number; hardwareConcurrency?: number }` ; `function detectQuality(env?: QualityEnv): QualityTier` ; `function readQualityEnv(): QualityEnv` ; `const WORLD_PACKAGE_NAME: string`.

- [ ] **Step 1 : Créer les fichiers de configuration**

`packages/world/package.json` :

```json
{
  "name": "@iwsdk/cardinal-world",
  "version": "0.1.0",
  "description": "Procedural ECS environment rendering (sky, terrain, water, flora) for the Cardinal stack",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "@iwsdk/core": ">=0.5.0"
  },
  "devDependencies": {
    "@iwsdk/core": "0.5.3",
    "@types/node": "^22.20.1",
    "elics": "3.4.2",
    "tsup": "^8.5.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  },
  "engines": {
    "node": ">=20.19.0"
  }
}
```

`packages/world/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/world/tsup.config.ts` :

```ts
import { defineConfig } from 'tsup';

// Single ESM library entry. `@iwsdk/core` (which re-exports Three) stays
// external so the host application resolves a single Three instance.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  external: ['@iwsdk/core', 'three', 'elics'],
});
```

`packages/world/vitest.config.ts` :

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Swap the DOM-bound `@iwsdk/core` for a shim over the real `elics`
      // runtime — same trick as packages/ai. See test/mocks/iwsdk-core.ts.
      '@iwsdk/core': fileURLToPath(new URL('./test/mocks/iwsdk-core.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.ts'] },
  },
});
```

- [ ] **Step 2 : Créer le mock de test**

`packages/world/test/mocks/iwsdk-core.ts` — reproduit le patron de `packages/ai/test/mocks/iwsdk-core.ts` en y ajoutant les deux composants d'environnement d'IWSDK dont nos systèmes ont besoin :

```ts
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

const gradientSchema = {
  sky: { type: Types.Color, default: [0.5, 0.7, 1, 1] },
  equator: { type: Types.Color, default: [0.8, 0.85, 0.9, 1] },
  ground: { type: Types.Color, default: [0.3, 0.28, 0.25, 1] },
  intensity: { type: Types.Float32, default: 1 },
  _needsUpdate: { type: Types.Boolean, default: true },
};

export const DomeGradient = createComponent('DomeGradient', gradientSchema, 'Sky dome');
export const IBLGradient = createComponent('IBLGradient', gradientSchema, 'Environment IBL');
```

- [ ] **Step 3 : Écrire le test qui échoue**

`packages/world/test/quality.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { detectQuality, WORLD_PACKAGE_NAME } from '../src/core/quality';

describe('detectQuality', () => {
  it('picks low on standalone Quest headsets', () => {
    expect(detectQuality({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/34.0' })).toBe('low');
    expect(detectQuality({ userAgent: 'Quest 3 Browser' })).toBe('low');
  });

  it('picks low on weak devices regardless of user agent', () => {
    expect(detectQuality({ userAgent: 'Chrome', deviceMemory: 4 })).toBe('low');
    expect(detectQuality({ userAgent: 'Chrome', hardwareConcurrency: 4 })).toBe('low');
  });

  it('picks high on a capable desktop', () => {
    expect(detectQuality({ userAgent: 'Chrome', deviceMemory: 16, hardwareConcurrency: 12 })).toBe('high');
  });

  it('defaults to low when nothing is known (safe for VR)', () => {
    expect(detectQuality({})).toBe('low');
  });

  it('exposes the package name', () => {
    expect(WORLD_PACKAGE_NAME).toBe('@iwsdk/cardinal-world');
  });
});
```

- [ ] **Step 4 : Vérifier l'échec**

Run : `pnpm install && cd packages/world && pnpm vitest run quality`
Expected : FAIL — `Cannot find module '../src/core/quality'`.

- [ ] **Step 5 : Implémenter**

`packages/world/src/core/quality.ts` :

```ts
/**
 * Runtime quality tier (spec §2, §5). Every visual effect exists in a
 * mobile-safe and a desktop-rich variant; this is what picks between them.
 * Pure and environment-injected so it is testable without globals.
 */
export type QualityTier = 'low' | 'high';

export const WORLD_PACKAGE_NAME = '@iwsdk/cardinal-world';

export interface QualityEnv {
  userAgent?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

const STANDALONE_VR = /OculusBrowser|Quest|Pico|Wolvic/i;

export function detectQuality(env: QualityEnv = readQualityEnv()): QualityTier {
  if (env.userAgent !== undefined && STANDALONE_VR.test(env.userAgent)) return 'low';
  const memory = env.deviceMemory;
  const cores = env.hardwareConcurrency;
  // Unknown hardware defaults to low: shipping a too-heavy scene to a headset
  // is far worse than shipping a too-light one to a desktop.
  if (memory === undefined && cores === undefined) return 'low';
  if (memory !== undefined && memory <= 4) return 'low';
  if (cores !== undefined && cores <= 4) return 'low';
  return 'high';
}

export function readQualityEnv(): QualityEnv {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  };
}
```

`packages/world/src/index.ts` :

```ts
export {
  detectQuality,
  readQualityEnv,
  WORLD_PACKAGE_NAME,
  type QualityTier,
  type QualityEnv,
} from './core/quality';
```

- [ ] **Step 6 : Vérifier le passage**

Run : `pnpm vitest run quality` → 5 passed ; puis `pnpm typecheck` et `pnpm build` → `dist/index.js` et `dist/index.d.ts` générés.

- [ ] **Step 7 : Brancher dans les scripts racine**

Dans `package.json` (racine), ajouter `@iwsdk/cardinal-world` aux trois scripts, **après** `cardinal-simulation` et **avant** `plugin-phoenix` :

- `"build"` : insérer `pnpm --filter @iwsdk/cardinal-world build && `
- `"test"` : insérer `pnpm --filter @iwsdk/cardinal-world test && `
- `"typecheck"` : insérer `pnpm --filter @iwsdk/cardinal-world typecheck && `

Run : `pnpm test` depuis la racine → toutes les suites passent, y compris `check-single-three: OK`.

- [ ] **Step 8 : Commit**

```bash
git add packages/world package.json pnpm-lock.yaml
git commit -m "feat(world): scaffold @iwsdk/cardinal-world with runtime quality tiers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : Position solaire (astronomie pure)

**Files:**
- Create: `packages/world/src/atmosphere/solar.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/solar.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces : `interface SolarPosition { elevationDeg: number; azimuthDeg: number }` ; `function solarPosition(hour: number, latitudeDeg: number, declinationDeg?: number): SolarPosition` (déclinaison par défaut 0 = équinoxe) ; `function declinationForDayOfYear(dayOfYear: number): number`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/world/test/solar.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { solarPosition, declinationForDayOfYear } from '../src/atmosphere/solar';

describe('solarPosition', () => {
  it('puts the sun at the zenith at noon on the equator at equinox', () => {
    const { elevationDeg } = solarPosition(12, 0);
    expect(elevationDeg).toBeCloseTo(90, 1);
  });

  it('puts the sun on the horizon at 6h and 18h at equinox', () => {
    expect(solarPosition(6, 45).elevationDeg).toBeCloseTo(0, 1);
    expect(solarPosition(18, 45).elevationDeg).toBeCloseTo(0, 1);
  });

  it('lowers the noon sun as latitude increases', () => {
    const equator = solarPosition(12, 0).elevationDeg;
    const paris = solarPosition(12, 48).elevationDeg;
    const arctic = solarPosition(12, 70).elevationDeg;
    expect(equator).toBeGreaterThan(paris);
    expect(paris).toBeGreaterThan(arctic);
    expect(paris).toBeCloseTo(42, 0); // 90 - 48 at equinox
  });

  it('reports a negative elevation at night', () => {
    expect(solarPosition(0, 45).elevationDeg).toBeLessThan(-30);
    expect(solarPosition(23, 45).elevationDeg).toBeLessThan(0);
  });

  it('sweeps azimuth from east to west across the day', () => {
    const morning = solarPosition(9, 45).azimuthDeg;
    const afternoon = solarPosition(15, 45).azimuthDeg;
    expect(morning).toBeGreaterThan(0);
    expect(morning).toBeLessThan(180);
    expect(afternoon).toBeGreaterThan(180);
    expect(afternoon).toBeLessThan(360);
  });

  it('is continuous across the day (no jumps in elevation)', () => {
    let previous = solarPosition(0, 45).elevationDeg;
    for (let hour = 0.1; hour <= 24; hour += 0.1) {
      const current = solarPosition(hour, 45).elevationDeg;
      expect(Math.abs(current - previous)).toBeLessThan(2);
      previous = current;
    }
  });

  it('declination follows the seasons', () => {
    expect(declinationForDayOfYear(172)).toBeCloseTo(23.4, 0); // solstice d'été
    expect(declinationForDayOfYear(355)).toBeCloseTo(-23.4, 0); // solstice d'hiver
    expect(Math.abs(declinationForDayOfYear(80))).toBeLessThan(2); // équinoxe
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm vitest run solar`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/world/src/atmosphere/solar.ts` :

```ts
/**
 * Real solar position (spec §4). Standard hour-angle astronomy, kept pure so
 * the sun's arc can be unit-tested without a renderer: a sun that rises in
 * the wrong place ruins every downstream lighting decision.
 */
export interface SolarPosition {
  elevationDeg: number;
  azimuthDeg: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const AXIAL_TILT_DEG = 23.44;

/** Solar declination for a day of year (1-365), sinusoidal approximation. */
export function declinationForDayOfYear(dayOfYear: number): number {
  return AXIAL_TILT_DEG * Math.sin(((360 / 365) * (dayOfYear - 81)) * DEG);
}

export function solarPosition(
  hour: number,
  latitudeDeg: number,
  declinationDeg = 0
): SolarPosition {
  const hourAngle = (hour - 12) * 15 * DEG; // 15° per hour, 0 at solar noon
  const latitude = latitudeDeg * DEG;
  const declination = declinationDeg * DEG;

  const sinElevation =
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinElevation)));

  const cosAzimuth =
    (Math.sin(declination) - Math.sin(elevation) * Math.sin(latitude)) /
    (Math.cos(elevation) * Math.cos(latitude) || 1e-6);
  let azimuth = Math.acos(Math.min(1, Math.max(-1, cosAzimuth))) * RAD;
  // acos gives 0..180 (north-based); mirror it for the afternoon half.
  if (hourAngle > 0) azimuth = 360 - azimuth;

  return { elevationDeg: elevation * RAD, azimuthDeg: azimuth };
}
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm vitest run solar` → 7 passed ; `pnpm typecheck`.

Si le test d'azimut échoue, vérifier la convention : ici l'azimut est mesuré **depuis le nord, dans le sens horaire** — le matin (angle horaire négatif) donne 0-180° (est), l'après-midi 180-360° (ouest).

- [ ] **Step 5 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export {
  solarPosition,
  declinationForDayOfYear,
  type SolarPosition,
} from './atmosphere/solar';
```

```bash
git add packages/world/src/atmosphere/solar.ts packages/world/src/index.ts packages/world/test/solar.test.ts
git commit -m "feat(world): real solar position from hour, latitude and declination

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Modèle de couleur du ciel (diffusion approchée)

**Files:**
- Create: `packages/world/src/atmosphere/skyColors.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/sky-colors.test.ts`

**Interfaces:**
- Consumes: rien (fonction pure).
- Produces :
  - `type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm'`
  - `interface SkyAppearance { sky: [number, number, number]; equator: [number, number, number]; ground: [number, number, number]; domeIntensity: number; sunColor: [number, number, number]; sunIntensity: number; ambientIntensity: number; exposure: number; starOpacity: number }`
  - `function skyAppearance(elevationDeg: number, options?: { turbidity?: number; weather?: WeatherKind }): SkyAppearance`
  - Toutes les composantes RGB sont dans `[0, 1]`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/world/test/sky-colors.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { skyAppearance } from '../src/atmosphere/skyColors';

describe('skyAppearance', () => {
  it('is blue-dominant and bright at noon', () => {
    const noon = skyAppearance(80);
    const [r, , b] = noon.sky;
    expect(b).toBeGreaterThan(r); // Rayleigh: blue scatters most
    expect(noon.sunIntensity).toBeGreaterThan(0.8);
    expect(noon.starOpacity).toBe(0);
  });

  it('is red-dominant at the horizon (long optical path)', () => {
    const sunset = skyAppearance(0);
    const [r, , b] = sunset.equator;
    expect(r).toBeGreaterThan(b);
    expect(sunset.sunColor[0]).toBeGreaterThan(sunset.sunColor[2]);
  });

  it('goes dark at night with stars fully out and no sun', () => {
    const night = skyAppearance(-30);
    for (const channel of night.sky) expect(channel).toBeLessThan(0.12);
    expect(night.sunIntensity).toBe(0);
    expect(night.starOpacity).toBe(1);
  });

  it('keeps every channel inside [0, 1] across the whole arc', () => {
    for (let elevation = -90; elevation <= 90; elevation += 1) {
      const appearance = skyAppearance(elevation, { turbidity: 6 });
      for (const triplet of [appearance.sky, appearance.equator, appearance.ground, appearance.sunColor]) {
        for (const channel of triplet) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is continuous: no visible jump between neighbouring elevations', () => {
    let previous = skyAppearance(-90).sky;
    for (let elevation = -89; elevation <= 90; elevation += 1) {
      const current = skyAppearance(elevation).sky;
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(current[channel]! - previous[channel]!)).toBeLessThan(0.08);
      }
      previous = current;
    }
  });

  it('storms darken and desaturate relative to clear skies', () => {
    const clear = skyAppearance(45, { weather: 'clear' });
    const storm = skyAppearance(45, { weather: 'storm' });
    const luminance = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const saturation = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
    expect(luminance(storm.sky)).toBeLessThan(luminance(clear.sky));
    expect(saturation(storm.sky)).toBeLessThan(saturation(clear.sky));
    expect(storm.sunIntensity).toBeLessThan(clear.sunIntensity);
  });

  it('higher turbidity hazes the sky (less saturated)', () => {
    const crisp = skyAppearance(45, { turbidity: 2 });
    const hazy = skyAppearance(45, { turbidity: 9 });
    const saturation = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
    expect(saturation(hazy.sky)).toBeLessThan(saturation(crisp.sky));
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run sky-colors` → FAIL, module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/world/src/atmosphere/skyColors.ts` :

```ts
/**
 * Analytic sky appearance (spec §4). This is a documented APPROXIMATION of
 * Rayleigh/Mie scattering, not a physical solver: anchor colours interpolated
 * by sun elevation, then modulated by turbidity and weather. It buys the two
 * things that actually sell realism — a horizon that reddens as the sun sets,
 * and ambient light that reddens WITH it — at a cost of a few multiplications.
 */
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm';

export interface SkyAppearance {
  sky: [number, number, number];
  equator: [number, number, number];
  ground: [number, number, number];
  domeIntensity: number;
  sunColor: [number, number, number];
  sunIntensity: number;
  ambientIntensity: number;
  exposure: number;
  starOpacity: number;
}

type RGB = [number, number, number];

interface Anchor {
  elevation: number;
  sky: RGB;
  equator: RGB;
  ground: RGB;
  sun: RGB;
}

/** Anchors from night through twilight to full day. */
const ANCHORS: Anchor[] = [
  { elevation: -90, sky: [0.012, 0.016, 0.045], equator: [0.02, 0.024, 0.06], ground: [0.01, 0.01, 0.015], sun: [0, 0, 0] },
  { elevation: -8, sky: [0.03, 0.035, 0.09], equator: [0.09, 0.06, 0.11], ground: [0.02, 0.02, 0.028], sun: [0.1, 0.05, 0.04] },
  { elevation: 0, sky: [0.16, 0.16, 0.30], equator: [0.85, 0.42, 0.20], ground: [0.12, 0.09, 0.08], sun: [1.0, 0.45, 0.18] },
  { elevation: 10, sky: [0.28, 0.42, 0.72], equator: [0.85, 0.66, 0.52], ground: [0.24, 0.20, 0.16], sun: [1.0, 0.78, 0.55] },
  { elevation: 40, sky: [0.26, 0.48, 0.88], equator: [0.68, 0.78, 0.92], ground: [0.32, 0.29, 0.24], sun: [1.0, 0.96, 0.90] },
  { elevation: 90, sky: [0.22, 0.45, 0.92], equator: [0.62, 0.76, 0.95], ground: [0.34, 0.31, 0.26], sun: [1.0, 0.99, 0.96] },
];

const WEATHER_FACTORS: Record<WeatherKind, { luminance: number; saturation: number; sun: number }> = {
  clear: { luminance: 1, saturation: 1, sun: 1 },
  cloudy: { luminance: 0.8, saturation: 0.65, sun: 0.6 },
  rain: { luminance: 0.6, saturation: 0.45, sun: 0.35 },
  storm: { luminance: 0.42, saturation: 0.28, sun: 0.2 },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Pull a colour toward its own luminance (desaturate) and scale brightness. */
function grade(color: RGB, saturation: number, luminance: number): RGB {
  const grey = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  return [
    clamp01((grey + (color[0] - grey) * saturation) * luminance),
    clamp01((grey + (color[1] - grey) * saturation) * luminance),
    clamp01((grey + (color[2] - grey) * saturation) * luminance),
  ];
}

export function skyAppearance(
  elevationDeg: number,
  options: { turbidity?: number; weather?: WeatherKind } = {}
): SkyAppearance {
  const turbidity = Math.min(10, Math.max(1, options.turbidity ?? 2.5));
  const weather = WEATHER_FACTORS[options.weather ?? 'clear'];

  // Locate the surrounding anchors and interpolate.
  let lower = ANCHORS[0]!;
  let upper = ANCHORS[ANCHORS.length - 1]!;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (elevationDeg >= ANCHORS[i]!.elevation && elevationDeg <= ANCHORS[i + 1]!.elevation) {
      lower = ANCHORS[i]!;
      upper = ANCHORS[i + 1]!;
      break;
    }
  }
  const span = upper.elevation - lower.elevation;
  const t = span > 0 ? clamp01((elevationDeg - lower.elevation) / span) : 0;

  // Turbidity hazes: pull saturation down as aerosols rise.
  const hazeSaturation = 1 - (turbidity - 1) * 0.055;
  const saturation = hazeSaturation * weather.saturation;
  const luminance = weather.luminance;

  const sky = grade(mix(lower.sky, upper.sky, t), saturation, luminance);
  const equator = grade(mix(lower.equator, upper.equator, t), saturation, luminance);
  const ground = grade(mix(lower.ground, upper.ground, t), saturation, luminance);
  const sunColor = grade(mix(lower.sun, upper.sun, t), saturation, 1);

  // Sun intensity follows its height, fading out below the horizon.
  const dayFactor = clamp01((elevationDeg + 4) / 14);
  const sunIntensity = clamp01(Math.sin(clamp01(elevationDeg / 90) * (Math.PI / 2))) * weather.sun * dayFactor;
  const ambientIntensity = 0.08 + 0.62 * dayFactor * luminance;
  const domeIntensity = 0.6 + 0.4 * dayFactor;
  // Brighter scenes need less exposure; twilight needs more to stay readable.
  const exposure = 1.35 - 0.45 * dayFactor;
  const starOpacity = clamp01((-elevationDeg - 2) / 8);

  return {
    sky,
    equator,
    ground,
    domeIntensity,
    sunColor,
    sunIntensity,
    ambientIntensity,
    exposure,
    starOpacity,
  };
}
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm vitest run sky-colors` → 7 passed.

Si le test de continuité échoue, c'est que deux ancres voisines sont trop éloignées en couleur pour l'écart d'élévation qui les sépare : rapprocher les ancres (en ajouter une) plutôt que de relâcher le seuil du test — le seuil traduit une exigence visuelle réelle (pas de saut perceptible d'une seconde à l'autre).

- [ ] **Step 5 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export { skyAppearance, type SkyAppearance, type WeatherKind } from './atmosphere/skyColors';
```

```bash
git add packages/world/src/atmosphere/skyColors.ts packages/world/src/index.ts packages/world/test/sky-colors.test.ts
git commit -m "feat(world): analytic sky appearance model with turbidity and weather grading

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Composants et systèmes ECS de l'atmosphère

**Files:**
- Create: `packages/world/src/atmosphere/components.ts`
- Create: `packages/world/src/atmosphere/CelestialTimeSystem.ts`
- Create: `packages/world/src/atmosphere/SkyRenderSystem.ts`
- Create: `packages/world/src/atmosphere/StarFieldSystem.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/atmosphere-systems.test.ts`

**Interfaces:**
- Consumes: `solarPosition` (Task 2), `skyAppearance`/`WeatherKind` (Task 3), `QualityTier` (Task 1), `DomeGradient`/`IBLGradient` (fournis par `@iwsdk/core`, stubés dans le mock).
- Produces :
  - `const CelestialTime` — champs `hour` (Float32, défaut 12), `latitudeDeg` (Float32, défaut 45), `dayOfYear` (Float32, défaut 172), `weather` (Int32, défaut 0 = clear)
  - `const SkyModel` — champs `turbidity` (Float32, 2.5), `sunElevationDeg` (Float32, 45), `sunAzimuthDeg` (Float32, 180), `moonPhase` (Float32, 0.5), `exposure` (Float32, 1), `_needsUpdate` (Boolean, true)
  - `const StarField` — champs `count` (Int32, 400), `radius` (Float32, 900), `opacity` (Float32, 0)
  - `const WEATHER_KINDS: WeatherKind[]` — index ↔ nom, `['clear', 'cloudy', 'rain', 'storm']`
  - `class CelestialTimeSystem`, `class SkyRenderSystem`, `class StarFieldSystem`
  - `SkyRenderSystem` expose `IBL_REFRESH_ELEVATION_DEG = 1` et une propriété publique `iblRefreshCount: number` (lecture seule en pratique) pour rendre l'étranglement testable.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/world/test/atmosphere-systems.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World, DomeGradient, IBLGradient } from '@iwsdk/core';
import { CelestialTime, SkyModel, StarField } from '../src/atmosphere/components';
import { CelestialTimeSystem } from '../src/atmosphere/CelestialTimeSystem';
import { SkyRenderSystem, IBL_REFRESH_ELEVATION_DEG } from '../src/atmosphere/SkyRenderSystem';
import { StarFieldSystem } from '../src/atmosphere/StarFieldSystem';

/**
 * Systems are driven explicitly, in order — the pattern already used by
 * packages/ai (see test/ai-lod.test.ts). It keeps the test deterministic and
 * independent of any scheduler in the mock.
 */
function makeWorld() {
  const world = new World();
  world
    .registerComponent(CelestialTime)
    .registerComponent(SkyModel)
    .registerComponent(StarField)
    .registerComponent(DomeGradient)
    .registerComponent(IBLGradient);
  world.registerSystem(CelestialTimeSystem);
  world.registerSystem(SkyRenderSystem);
  world.registerSystem(StarFieldSystem);
  return {
    world,
    time: world.getSystem(CelestialTimeSystem) as CelestialTimeSystem,
    sky: world.getSystem(SkyRenderSystem) as SkyRenderSystem,
    stars: world.getSystem(StarFieldSystem) as StarFieldSystem,
    /** One simulated frame: astronomy first, then rendering. */
    frame(): void {
      this.time.update(0.016, 0);
      this.sky.update(0.016, 0);
      this.stars.update(0.016, 0);
    },
  };
}

function makeSkyEntity(world: World, hour: number) {
  const entity = world.createEntity();
  entity.addComponent(CelestialTime, { hour, latitudeDeg: 45, dayOfYear: 80 });
  entity.addComponent(SkyModel, {});
  entity.addComponent(StarField, {});
  entity.addComponent(DomeGradient, {});
  entity.addComponent(IBLGradient, {});
  return entity;
}

describe('CelestialTimeSystem', () => {
  it('writes the solar position into SkyModel and raises _needsUpdate', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    entity.setValue(SkyModel, '_needsUpdate', false);
    rig.time.update(0.016, 0);
    expect(entity.getValue(SkyModel, 'sunElevationDeg')).toBeCloseTo(45, 0);
    expect(entity.getValue(SkyModel, '_needsUpdate')).toBe(true);
  });

  it('reports a sun below the horizon at midnight', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 0);
    rig.time.update(0.016, 0);
    expect(entity.getValue(SkyModel, 'sunElevationDeg')).toBeLessThan(0);
  });
});

describe('SkyRenderSystem', () => {
  it('drives the dome gradient from the sky model', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    rig.frame();
    const sky = entity.getVectorView(DomeGradient, 'sky');
    expect(sky[2]).toBeGreaterThan(sky[0]); // midday sky is blue-dominant
    expect(entity.getValue(DomeGradient, '_needsUpdate')).toBe(true);
    expect(entity.getValue(DomeGradient, 'intensity')).toBeGreaterThan(0);
  });

  it('clears _needsUpdate on the sky model once applied', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    rig.frame();
    expect(entity.getValue(SkyModel, '_needsUpdate')).toBe(false);
  });

  it('throttles IBL regeneration to meaningful sun movement', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    rig.frame();
    const afterFirst = rig.sky.iblRefreshCount;
    expect(afterFirst).toBe(1); // first application always refreshes

    // A tiny step moves the sun far less than the threshold.
    entity.setValue(CelestialTime, 'hour', 12.01);
    rig.frame();
    expect(rig.sky.iblRefreshCount).toBe(afterFirst);

    // A large jump exceeds the threshold and refreshes again.
    entity.setValue(CelestialTime, 'hour', 17);
    rig.frame();
    expect(rig.sky.iblRefreshCount).toBe(afterFirst + 1);
    expect(IBL_REFRESH_ELEVATION_DEG).toBe(1);
  });

  it('darkens the dome under a storm', () => {
    const rig = makeWorld();
    const clearEntity = makeSkyEntity(rig.world, 12);
    const stormEntity = makeSkyEntity(rig.world, 12);
    stormEntity.setValue(CelestialTime, 'weather', 3); // storm
    rig.frame();
    const clearSky = clearEntity.getVectorView(DomeGradient, 'sky');
    const stormSky = stormEntity.getVectorView(DomeGradient, 'sky');
    const luminance = (c: ArrayLike<number>) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(luminance(stormSky)).toBeLessThan(luminance(clearSky));
  });
});

describe('StarFieldSystem', () => {
  it('shows stars at night and hides them by day', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 0);
    rig.frame();
    expect(entity.getValue(StarField, 'opacity')).toBeGreaterThan(0.5);

    entity.setValue(CelestialTime, 'hour', 12);
    rig.frame();
    expect(entity.getValue(StarField, 'opacity')).toBe(0);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run atmosphere-systems` → FAIL, modules introuvables.

- [ ] **Step 3 : Implémenter les composants**

`packages/world/src/atmosphere/components.ts` :

```ts
import { Types, createComponent } from '@iwsdk/core';
import type { WeatherKind } from './skyColors';

/** Index ↔ name mapping for the numeric `weather` field. */
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm'];

/**
 * The clock, fed by the simulation (spec §4). Data, not appearance —
 * which is why it is a separate component from SkyModel.
 */
export const CelestialTime = createComponent(
  'CelestialTime',
  {
    hour: { type: Types.Float32, default: 12 },
    latitudeDeg: { type: Types.Float32, default: 45 },
    dayOfYear: { type: Types.Float32, default: 172 },
    weather: { type: Types.Int32, default: 0 },
  },
  'Simulation-driven time of day, latitude and weather',
);

/** Physical parameters of the atmosphere. Root-only, like DomeGradient. */
export const SkyModel = createComponent(
  'SkyModel',
  {
    turbidity: { type: Types.Float32, default: 2.5 },
    sunElevationDeg: { type: Types.Float32, default: 45 },
    sunAzimuthDeg: { type: Types.Float32, default: 180 },
    moonPhase: { type: Types.Float32, default: 0.5 },
    exposure: { type: Types.Float32, default: 1 },
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Physical sky parameters derived from CelestialTime',
);

/** Night sky. */
export const StarField = createComponent(
  'StarField',
  {
    count: { type: Types.Int32, default: 400 },
    radius: { type: Types.Float32, default: 900 },
    opacity: { type: Types.Float32, default: 0 },
  },
  'Procedural star field',
);
```

- [ ] **Step 4 : Implémenter les trois systèmes**

`packages/world/src/atmosphere/CelestialTimeSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { CelestialTime, SkyModel } from './components';
import { solarPosition, declinationForDayOfYear } from './solar';

/**
 * Astronomy only: turns the simulation's clock into a sun position.
 * No Three.js here — that is what makes the sun's arc unit-testable.
 */
export class CelestialTimeSystem extends createSystem({
  clocks: { required: [CelestialTime, SkyModel] },
}) {
  public override update(_delta: number, _time: number): void {
    for (const entity of this.queries.clocks.entities) {
      const hour = entity.getValue(CelestialTime, 'hour') ?? 12;
      const latitude = entity.getValue(CelestialTime, 'latitudeDeg') ?? 45;
      const dayOfYear = entity.getValue(CelestialTime, 'dayOfYear') ?? 172;

      const { elevationDeg, azimuthDeg } = solarPosition(
        hour,
        latitude,
        declinationForDayOfYear(dayOfYear),
      );

      const previousElevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;
      const previousAzimuth = entity.getValue(SkyModel, 'sunAzimuthDeg') ?? 0;
      if (
        Math.abs(previousElevation - elevationDeg) > 1e-4 ||
        Math.abs(previousAzimuth - azimuthDeg) > 1e-4
      ) {
        entity.setValue(SkyModel, 'sunElevationDeg', elevationDeg);
        entity.setValue(SkyModel, 'sunAzimuthDeg', azimuthDeg);
        entity.setValue(SkyModel, '_needsUpdate', true);
      }
    }
  }
}
```

`packages/world/src/atmosphere/SkyRenderSystem.ts` :

```ts
import { Types, createSystem, DomeGradient, IBLGradient } from '@iwsdk/core';
import { CelestialTime, SkyModel, WEATHER_KINDS } from './components';
import { skyAppearance } from './skyColors';

/** Sun elevation change (degrees) required to justify a new IBL bake. */
export const IBL_REFRESH_ELEVATION_DEG = 1;

/**
 * Applies the sky model to IWSDK's native environment primitives (spec §4):
 * DomeGradient for the background dome, IBLGradient for image-based lighting,
 * plus the sun's own directional light when a real renderer is present.
 *
 * IBL regeneration produces a PMREM and is expensive — it is throttled to
 * meaningful sun movement. The dome is nearly free and follows continuously;
 * the eye never notices the difference.
 */
export class SkyRenderSystem extends createSystem(
  {
    skies: { required: [SkyModel, DomeGradient] },
  },
  {
    quality: { type: Types.String, default: 'low' },
  },
) {
  public iblRefreshCount = 0;
  private lastIblElevation = Number.NEGATIVE_INFINITY;

  public override update(_delta: number, _time: number): void {
    for (const entity of this.queries.skies.entities) {
      if (entity.getValue(SkyModel, '_needsUpdate') !== true) continue;

      const elevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;
      const turbidity = entity.getValue(SkyModel, 'turbidity') ?? 2.5;
      const weatherIndex = entity.hasComponent(CelestialTime)
        ? (entity.getValue(CelestialTime, 'weather') ?? 0)
        : 0;
      const weather = WEATHER_KINDS[weatherIndex] ?? 'clear';

      const appearance = skyAppearance(elevation, { turbidity, weather });

      const dome = entity.getVectorView(DomeGradient, 'sky');
      dome[0] = appearance.sky[0];
      dome[1] = appearance.sky[1];
      dome[2] = appearance.sky[2];
      const domeEquator = entity.getVectorView(DomeGradient, 'equator');
      domeEquator[0] = appearance.equator[0];
      domeEquator[1] = appearance.equator[1];
      domeEquator[2] = appearance.equator[2];
      const domeGround = entity.getVectorView(DomeGradient, 'ground');
      domeGround[0] = appearance.ground[0];
      domeGround[1] = appearance.ground[1];
      domeGround[2] = appearance.ground[2];
      entity.setValue(DomeGradient, 'intensity', appearance.domeIntensity);
      entity.setValue(DomeGradient, '_needsUpdate', true);

      entity.setValue(SkyModel, 'exposure', appearance.exposure);

      // Expensive: only rebake the environment when the sun really moved.
      if (
        entity.hasComponent(IBLGradient) &&
        Math.abs(elevation - this.lastIblElevation) >= IBL_REFRESH_ELEVATION_DEG
      ) {
        this.lastIblElevation = elevation;
        this.iblRefreshCount++;
        const iblSky = entity.getVectorView(IBLGradient, 'sky');
        iblSky[0] = appearance.sky[0];
        iblSky[1] = appearance.sky[1];
        iblSky[2] = appearance.sky[2];
        const iblEquator = entity.getVectorView(IBLGradient, 'equator');
        iblEquator[0] = appearance.equator[0];
        iblEquator[1] = appearance.equator[1];
        iblEquator[2] = appearance.equator[2];
        const iblGround = entity.getVectorView(IBLGradient, 'ground');
        iblGround[0] = appearance.ground[0];
        iblGround[1] = appearance.ground[1];
        iblGround[2] = appearance.ground[2];
        entity.setValue(IBLGradient, 'intensity', appearance.ambientIntensity);
        entity.setValue(IBLGradient, '_needsUpdate', true);
      }

      entity.setValue(SkyModel, '_needsUpdate', false);
    }
  }
}
```

`packages/world/src/atmosphere/StarFieldSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { SkyModel, StarField } from './components';
import { skyAppearance } from './skyColors';

/** Star opacity follows the sun below the horizon. */
export class StarFieldSystem extends createSystem({
  fields: { required: [StarField, SkyModel] },
}) {
  public override update(_delta: number, _time: number): void {
    for (const entity of this.queries.fields.entities) {
      const elevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;
      const { starOpacity } = skyAppearance(elevation);
      entity.setValue(StarField, 'opacity', starOpacity);
    }
  }
}
```

- [ ] **Step 5 : Vérifier le passage**

Run : `pnpm vitest run atmosphere-systems` → 7 passed ; puis `pnpm vitest run` (toute la suite du paquet) et `pnpm typecheck`.

Deux points susceptibles de demander un ajustement :

1. **`getVectorView` sur un champ `Types.Color`.** Si elics expose les couleurs autrement (quatre composantes RVBA), adapter les écritures en conservant l'alpha à 1 — et ajuster le mock en conséquence.
2. **Ordre des systèmes à l'exécution réelle.** Les tests pilotent les systèmes explicitement dans le bon ordre, donc ils ne diront rien de ce point. Mais en production, `CelestialTimeSystem` doit s'exécuter avant `SkyRenderSystem` dans la même frame, faute de quoi le rendu appliquerait la position solaire de la frame précédente (décalage d'une frame, invisible mais incorrect). Si l'ordre d'enregistrement ne le garantit pas, passer une `priority` décroissante à `registerSystem`, comme le fait `packages/ai`. **À vérifier à l'étape 7 de la tâche 5**, pendant la validation visuelle.

- [ ] **Step 6 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export { CelestialTime, SkyModel, StarField, WEATHER_KINDS } from './atmosphere/components';
export { CelestialTimeSystem } from './atmosphere/CelestialTimeSystem';
export { SkyRenderSystem, IBL_REFRESH_ELEVATION_DEG } from './atmosphere/SkyRenderSystem';
export { StarFieldSystem } from './atmosphere/StarFieldSystem';
```

```bash
git add packages/world/src/atmosphere packages/world/src/index.ts packages/world/test/atmosphere-systems.test.ts
git commit -m "feat(world): atmosphere components and systems driving IWSDK dome and IBL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : Installation et intégration dans la démo

**Files:**
- Create: `packages/world/src/install.ts`
- Modify: `packages/world/src/index.ts`
- Modify: `apps/demo/package.json` (dépendance workspace)
- Modify: `apps/demo/src/index.ts`
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts`
- Delete: `apps/demo/src/simulation/CelestialVisuals.ts`
- Verify: typecheck démo, suite complète, builds

**Interfaces:**
- Consumes: tous les composants et systèmes des tâches 1 à 4.
- Produces :
  - `interface CardinalWorldOptions { quality?: QualityTier; latitudeDeg?: number; dayOfYear?: number; turbidity?: number }`
  - `function installCardinalWorld(world: World, options?: CardinalWorldOptions): { quality: QualityTier }`
  - `function withLevelRoot(world: World, callback: (root: Entity) => void): void`

- [ ] **Step 1 : Écrire la fonction d'installation**

`packages/world/src/install.ts` :

```ts
import { DomeGradient, IBLGradient, type Entity, type World } from '@iwsdk/core';
import { detectQuality, type QualityTier } from './core/quality';
import { CelestialTime, SkyModel, StarField } from './atmosphere/components';
import { CelestialTimeSystem } from './atmosphere/CelestialTimeSystem';
import { SkyRenderSystem } from './atmosphere/SkyRenderSystem';
import { StarFieldSystem } from './atmosphere/StarFieldSystem';

export interface CardinalWorldOptions {
  quality?: QualityTier;
  latitudeDeg?: number;
  dayOfYear?: number;
  turbidity?: number;
}

/**
 * DomeGradient and IBLGradient only work on the level root — anywhere else
 * they are silently ignored. The active level may not be loaded yet at
 * install time, so run the callback now if it is, or once it arrives.
 */
export function withLevelRoot(world: World, callback: (root: Entity) => void): void {
  const current = world.activeLevel.peek();
  if (current) {
    callback(current);
    return;
  }
  const unsubscribe = world.activeLevel.subscribe((root: Entity | null) => {
    if (root) {
      callback(root);
      unsubscribe();
    }
  });
}

/**
 * Installs the environment package into a world: components, systems, and
 * the sky rig on the level root. Mirrors installCardinalAI's shape.
 */
export function installCardinalWorld(
  world: World,
  options: CardinalWorldOptions = {},
): { quality: QualityTier } {
  const quality = options.quality ?? detectQuality();

  world
    .registerComponent(CelestialTime)
    .registerComponent(SkyModel)
    .registerComponent(StarField);

  world.registerSystem(CelestialTimeSystem);
  world.registerSystem(SkyRenderSystem, { configData: { quality } });
  world.registerSystem(StarFieldSystem);

  withLevelRoot(world, (root) => {
    if (!root.hasComponent(CelestialTime)) {
      root.addComponent(CelestialTime, {
        hour: 12,
        latitudeDeg: options.latitudeDeg ?? 45,
        dayOfYear: options.dayOfYear ?? 172,
        weather: 0,
      });
    }
    if (!root.hasComponent(SkyModel)) {
      root.addComponent(SkyModel, { turbidity: options.turbidity ?? 2.5 });
    }
    if (!root.hasComponent(StarField)) {
      root.addComponent(StarField, {});
    }
    if (!root.hasComponent(DomeGradient)) root.addComponent(DomeGradient, {});
    if (!root.hasComponent(IBLGradient)) root.addComponent(IBLGradient, {});
  });

  return { quality };
}
```

Ajouter dans `packages/world/src/index.ts` :

```ts
export {
  installCardinalWorld,
  withLevelRoot,
  type CardinalWorldOptions,
} from './install';
```

- [ ] **Step 2 : Vérifier le paquet**

Run : `pnpm vitest run && pnpm typecheck && pnpm build` (dans `packages/world`) → tout vert, `dist/` régénéré.

- [ ] **Step 3 : Brancher la démo**

Dans `apps/demo/package.json`, ajouter aux `dependencies` :

```json
"@iwsdk/cardinal-world": "workspace:*"
```

puis `pnpm install` à la racine.

Dans `apps/demo/src/index.ts` : ajouter l'import et l'appel, juste avant l'enregistrement de `CardinalSimulationSystem` :

```ts
import { installCardinalWorld } from '@iwsdk/cardinal-world';
```

```ts
    // 2a. Mount the procedural environment package (sky rig, quality tiers)
    const { quality } = installCardinalWorld(world, { latitudeDeg: 45 });
    console.log(`[demo] environment quality tier: ${quality}`);
```

- [ ] **Step 4 : Faire piloter l'heure par la simulation**

Dans `apps/demo/src/simulation/CardinalSimulationSystem.ts` :

Ajouter aux imports :

```ts
import { CelestialTime, WEATHER_KINDS } from '@iwsdk/cardinal-world';
```

Ajouter une méthode privée et son appel depuis `update(delta)` (juste après `this.kernel.advance(...)`) :

```ts
  /** Feed the simulation clock and weather into the environment package. */
  private publishCelestialTime(): void {
    const root = this.world.activeLevel.peek();
    if (!root || !root.hasComponent(CelestialTime)) return;
    root.setValue(CelestialTime, 'hour', this.hourOfDaySim());
    const weatherIndex = WEATHER_KINDS.indexOf(this.weather.current);
    root.setValue(CelestialTime, 'weather', weatherIndex >= 0 ? weatherIndex : 0);
  }
```

**Attention :** `WEATHER_KINDS` du paquet world (`'clear' | 'cloudy' | 'rain' | 'storm'`) et `WeatherState` du moteur de simulation ont exactement les mêmes valeurs — l'`indexOf` fonctionne donc directement. Si une divergence apparaissait, préférer une table de correspondance explicite plutôt qu'un cast.

- [ ] **Step 5 : Supprimer l'ancien ciel**

```bash
git rm apps/demo/src/simulation/CelestialVisuals.ts
```

Dans `CardinalSimulationSystem.ts`, retirer : l'import `CelestialVisuals`, la propriété `private celestial: CelestialVisuals | null = null;`, sa construction dans `attachScene` et l'appel `this.celestial?.update(...)` dans `projectScene`.

Vérifier qu'il ne reste aucune référence :

```bash
grep -rn "CelestialVisuals" apps/demo/src --include="*.ts"
```

Attendu : aucune sortie.

- [ ] **Step 6 : Vérification complète**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`, puis à la racine `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`.
Expected : tout vert, `check-single-three: OK` compris.

- [ ] **Step 7 : Vérification visuelle (manuelle, indispensable)**

Lancer `pnpm demo` et observer sur `https://localhost:8081/` :

1. Le ciel change de couleur au fil de la journée simulée (un jour dure 4 minutes réelles) : bleu à midi, orangé bas sur l'horizon, sombre la nuit.
2. **L'éclairage de la scène suit le ciel** — c'est le gain principal de cette phase : au crépuscule, le sol et les villageois doivent rougir aussi, pas seulement le dôme.
3. Le bouton « 🌧️ Tempête » du HUD assombrit et désature immédiatement le ciel.

Si le ciel ne bouge pas du tout, vérifier dans cet ordre : le composant est-il bien sur `world.activeLevel` (et non sur une autre entité) ; `_needsUpdate` est-il levé ; `CelestialTimeSystem` s'exécute-t-il avant `SkyRenderSystem`.

- [ ] **Step 8 : Commit**

```bash
git add -A packages/world apps/demo package.json pnpm-lock.yaml
git commit -m "refactor(demo): replace hand-rolled celestial visuals with cardinal-world sky rig

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Couverture spec (auto-contrôle)

| Exigence spec (phase 1) | Tâche(s) |
| :--- | :--- |
| Paquet `packages/world`, peer `@iwsdk/core`, jamais `three` en direct (§3) | 1 |
| Patron d'installation à la `packages/ai` (§3) | 5 |
| Service de qualité `low`/`high` détecté à l'exécution (§2, §4) | 1, 5 |
| `CelestialTime`, `SkyModel`, `StarField` (§4) | 4 |
| `CelestialTimeSystem` — position solaire réelle, zéro Three.js (§4) | 2, 4 |
| `SkyRenderSystem` — pilote `DomeGradient` et `IBLGradient` (§4) | 3, 4 |
| Étranglement de la régénération IBL ≥ 1° (§4) | 4 (test dédié) |
| `StarFieldSystem` — opacité suivant l'élévation (§4) | 4 |
| Toute la logique en fonctions pures testables (§10) | 2, 3 |
| Systèmes ECS testés avec un monde simulé, patron `packages/ai` (§10) | 1 (mock), 4 |
| Suppression de `CelestialVisuals.ts` (§11 phase 1) | 5 |
| L'heure et la météo de la simulation pilotent le ciel (§4) | 5 |

**Hors périmètre de cette phase**, conformément au phasage §11 : matériaux PBR et `MaterialLibrary` (phase 2) ; terrain, biomes et streaming (phase 3) ; eau (phase 4) ; flore (phase 5) ; faune et matériels (phase 6). Le rendu géométrique des étoiles (nuage de points) et la lumière directionnelle solaire attachée au renderer sont volontairement laissés à la phase 2, où la `MaterialLibrary` et le tone mapping fourniront le cadre : cette phase établit le **modèle** et le pilotage par composants, que `DomeGradient` et `IBLGradient` suffisent à rendre visibles.
