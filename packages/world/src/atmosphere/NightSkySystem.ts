import {
  createSystem,
  Group,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  PointsMaterial,
  Mesh,
  CircleGeometry,
  ShaderMaterial,
  AdditiveBlending,
  Color,
} from '@iwsdk/core';
import { CelestialTime, SkyModel, StarField } from './components';
import { moonPhaseForDay, moonPosition, moonlightIntensity } from './lunar';
import { declinationForDayOfYear } from './solar';
import { starPositions, starBrightness, skyDirection } from './nightSkyGeometry';

/** Rayon de la voûte, en mètres. Au-delà du terrain, en deçà du plan lointain. */
const SKY_RADIUS = 900;
/** Rayon apparent du disque lunaire, à cette distance. */
const MOON_RADIUS = 26;

/**
 * Dessine le ciel nocturne : les étoiles et la lune.
 *
 * Ces trois champs — `StarField.opacity`, `StarField.count`, `SkyModel.moonPhase` —
 * étaient déclarés depuis l'origine, calculés à chaque image, et lus par
 * PERSONNE. Un composant et un système ne font pas une implémentation : il
 * manquait le consommateur, et la nuit était vide sans que rien ne le dise.
 *
 * L'astronomie reste dans `lunar.ts` et la géométrie dans
 * `nightSkyGeometry.ts`, toutes deux pures et testées. Ce système ne fait que
 * les monter sur la voûte et suivre le joueur : rien ici ne mérite un GPU
 * pour être vérifié.
 */
export class NightSkySystem extends createSystem({
  skies: { required: [SkyModel, CelestialTime, StarField] },
}) {
  private dome: Group | null = null;
  private stars: Points | null = null;
  private moon: Mesh | null = null;
  private moonMaterial: ShaderMaterial | null = null;
  /** Dernière intensité lunaire appliquée, pour ne pas réécrire sans raison. */
  public moonlight = 0;

  override init(): void {
    // Tout est alloué ICI. Le budget d'image est de 11 ms : une allocation
    // par frame se paierait en ramasse-miettes au pire moment.
    const dome = new Group();
    dome.name = 'night-sky';
    // La voûte suit le joueur, donc rien ne la coupe ni ne l'occulte.
    dome.renderOrder = -1;

    const count = 400;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(starPositions(count, SKY_RADIUS), 3));
    geometry.setAttribute('aBrightness', new Float32BufferAttribute(starBrightness(count), 1));
    const starMaterial = new PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      color: new Color(0xdfe8ff),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const stars = new Points(geometry, starMaterial);
    stars.frustumCulled = false;
    dome.add(stars);

    // La phase se dessine, elle ne se texture pas : un terminateur est une
    // fonction, et une texture de lune coûterait un aller-retour disque pour
    // moins de justesse.
    const moonMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPhase: { value: 0.5 },
        uOpacity: { value: 0 },
        uColor: { value: new Color(0xfdf6e3) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uPhase;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;

          // Le terminateur est une ellipse dont la largeur suit la phase :
          // droite au premier quartier, disque plein à la pleine lune.
          float k = cos(uPhase * 6.2831853);
          float limbe = p.x - k * sqrt(max(0.0, 1.0 - p.y * p.y));
          float eclaire = smoothstep(-0.06, 0.06, uPhase < 0.5 ? limbe : -limbe);

          // Bord adouci, sinon le disque a l'air découpé aux ciseaux.
          float bord = 1.0 - smoothstep(0.94, 1.0, r);
          float a = uOpacity * eclaire * bord;
          if (a <= 0.001) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    const moon = new Mesh(new CircleGeometry(MOON_RADIUS, 32), moonMaterial);
    moon.frustumCulled = false;
    dome.add(moon);

    this.dome = dome;
    this.stars = stars;
    this.moon = moon;
    this.moonMaterial = moonMaterial;
    this.world.createTransformEntity(dome);
  }

  override update(_delta: number, _time: number): void {
    const dome = this.dome;
    if (dome === null) return;

    // La voûte est centrée sur le joueur : une sphère fixe finirait par se
    // trouver derrière lui après quelques centaines de mètres.
    const player = this.player as unknown as
      | { position: { x: number; y: number; z: number } }
      | undefined;
    if (player !== undefined) dome.position.set(player.position.x, player.position.y, player.position.z);

    for (const entity of this.queries.skies.entities) {
      const opacity = entity.getValue(StarField, 'opacity') ?? 0;
      const material = this.stars?.material as PointsMaterial | undefined;
      if (material !== undefined) {
        material.opacity = opacity;
        material.visible = opacity > 0.001;
      }

      const hour = entity.getValue(CelestialTime, 'hour') ?? 12;
      const latitude = entity.getValue(CelestialTime, 'latitudeDeg') ?? 45;
      const dayOfYear = entity.getValue(CelestialTime, 'dayOfYear') ?? 172;
      const sunElevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;

      const phase = moonPhaseForDay(dayOfYear);
      const { elevationDeg, azimuthDeg } = moonPosition(
        hour,
        latitude,
        phase,
        declinationForDayOfYear(dayOfYear),
      );

      if (this.moon !== null && this.moonMaterial !== null) {
        const [x, y, z] = skyDirection(elevationDeg, azimuthDeg, SKY_RADIUS);
        this.moon.position.set(x, y, z);
        // Le disque regarde toujours le centre de la voûte, donc le joueur.
        this.moon.lookAt(dome.position);
        this.moonMaterial.uniforms.uPhase!.value = phase;
        // Visible aussi en fin de journée, comme la vraie : elle s'efface
        // avec la lumière du jour plutôt que de disparaître d'un coup.
        const jour = Math.max(0, Math.min(1, (sunElevation + 6) / 12));
        this.moonMaterial.uniforms.uOpacity!.value = elevationDeg > -2 ? 1 - jour * 0.85 : 0;
        this.moon.visible = elevationDeg > -2;
      }

      this.moonlight = moonlightIntensity(sunElevation, elevationDeg, phase);
      if (Math.abs((entity.getValue(SkyModel, 'moonPhase') ?? -1) - phase) > 1e-4) {
        entity.setValue(SkyModel, 'moonPhase', phase);
      }
    }
  }
}
