import { ShaderMaterial, DoubleSide, Color } from '@iwsdk/core';
import { RIVER_WAVES_LOW, type GerstnerWave } from './waves';

/**
 * Le nuanceur d'eau (spec §7, niveau `low`).
 *
 * Tout ce qui pouvait être testé vit ailleurs — les vagues dans `waves.ts`, la
 * profondeur dans `riverGeometry.ts`. Il ne reste ici que la consommation
 * d'attributs et d'uniformes, un nuanceur exigeant un GPU pour être compilé.
 *
 * Le niveau `high` de la table §7 — réflexion planaire, cible de réfraction,
 * caustiques — n'est pas implémenté : `detectQuality()` rend `low` aussi bien
 * sur le matériel de développement que sur Quest, et livrer un chemin que nul
 * ne peut voir tourner serait livrer du code non vérifié.
 */

export const WATER_UNIFORM_NAMES: readonly string[] = [
  'uTime',
  'uWaves',
  'uShallowColor',
  'uDeepColor',
  'uSkyColor',
  'uFoamWidth',
  'uOpacity',
];

/** Cinq flottants par vague : direction, raideur, longueur, vitesse. */
export function buildWaterUniforms(
  waves: readonly GerstnerWave[],
): Record<string, { value: unknown }> {
  const packed: number[] = [];
  for (const w of waves) packed.push(w.dirX, w.dirZ, w.steepness, w.wavelength, w.speed);
  return {
    uTime: { value: 0 },
    uWaves: { value: packed },
    uShallowColor: { value: new Color(0x6fb3c9) },
    uDeepColor: { value: new Color(0x0b3d5c) },
    uSkyColor: { value: new Color(0x87b6de) },
    uFoamWidth: { value: 0.28 },
    uOpacity: { value: 0.86 },
  };
}

export function waterVertexShader(waveCount: number): string {
  // La boucle est DÉROULÉE : GLSL ES 1.0 exige des bornes constantes, et le
  // nombre de vagues dépend du niveau de qualité.
  let unrolled = '';
  for (let i = 0; i < waveCount; i++) {
    const b = i * 5;
    unrolled += `
  {
    vec2 dir = vec2(uWaves[${b}], uWaves[${b + 1}]);
    float steepness = uWaves[${b + 2}];
    float wavelength = uWaves[${b + 3}];
    float speed = uWaves[${b + 4}];
    float k = 6.2831853 / wavelength;
    float amplitude = steepness / k;
    float phase = k * dot(dir, position.xz) - speed * k * uTime;
    displaced.x += shore * dir.x * amplitude * cos(phase);
    displaced.z += shore * dir.y * amplitude * cos(phase);
    displaced.y += shore * amplitude * sin(phase);
  }`;
  }

  return `
uniform float uTime;
uniform float uWaves[${waveCount * 5}];
attribute float aDepth;
attribute vec2 aFlow;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vec3 displaced = position;
  // Les vagues s'éteignent près de la berge : une crête sur trois centimètres
  // d'eau flotterait dans le vide.
  float shore = smoothstep(0.0, 0.35, aDepth);
${unrolled}
  vDepth = aDepth;
  vFlow = aFlow;
  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWorldNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
}

export function waterFragmentShader(): string {
  return `
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform float uFoamWidth;
uniform float uOpacity;
uniform float uTime;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  // Réfraction du pauvre : la couleur s'assombrit avec la profondeur, ce qui
  // remplace une cible de réfraction pour un coût nul.
  float t = clamp(vDepth / 1.4, 0.0, 1.0);
  vec3 body = mix(uShallowColor, uDeepColor, t);

  // Fresnel de Schlick : l'eau réfléchit le ciel d'autant plus qu'on la
  // regarde de biais.
  float cosTheta = clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
  vec3 colour = mix(body, uSkyColor, fresnel);

  // Écume de rive, tirée de la SEULE profondeur — sans passe supplémentaire.
  float foam = 1.0 - smoothstep(0.0, uFoamWidth, vDepth);
  float ripple = 0.5 + 0.5 * sin(uTime * 3.0 + vFlow.x * 6.0 + vFlow.y * 4.0);
  colour = mix(colour, vec3(0.93, 0.96, 0.98), foam * (0.55 + 0.45 * ripple));

  // Le bord du ruban s'efface : une arête franche trahirait la géométrie.
  float alpha = uOpacity * smoothstep(0.0, 0.06, vDepth);
  gl_FragColor = vec4(colour, clamp(alpha + foam * 0.4, 0.0, 1.0));
}
`;
}

export function createWaterMaterial(
  waves: readonly GerstnerWave[] = RIVER_WAVES_LOW,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: buildWaterUniforms(waves),
    vertexShader: waterVertexShader(waves.length),
    fragmentShader: waterFragmentShader(),
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });
}
