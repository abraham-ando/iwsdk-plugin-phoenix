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
  { elevation: 0, sky: [0.16, 0.16, 0.3], equator: [0.85, 0.42, 0.2], ground: [0.12, 0.09, 0.08], sun: [1.0, 0.45, 0.18] },
  { elevation: 10, sky: [0.28, 0.42, 0.72], equator: [0.85, 0.66, 0.52], ground: [0.24, 0.2, 0.16], sun: [1.0, 0.78, 0.55] },
  { elevation: 40, sky: [0.26, 0.48, 0.88], equator: [0.68, 0.78, 0.92], ground: [0.32, 0.29, 0.24], sun: [1.0, 0.96, 0.9] },
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
  const sunIntensity =
    clamp01(Math.sin(clamp01(elevationDeg / 90) * (Math.PI / 2))) * weather.sun * dayFactor;
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
