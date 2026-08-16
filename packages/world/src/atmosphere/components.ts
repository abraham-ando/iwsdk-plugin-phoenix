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
