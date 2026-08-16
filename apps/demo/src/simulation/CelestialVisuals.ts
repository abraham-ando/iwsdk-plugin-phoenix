/**
 * Continuous celestial cycle + weather visuals (spec §10.1, §10.2), driven by
 * the simulation clock: sun/moon arcs, sky dome color palette, stars at
 * night, rain particles in rain/storm. All allocations happen in the
 * constructor — update() mutates in place (VR budget: zero per-frame alloc).
 */
import {
  Group,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  BackSide,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Color,
} from '@iwsdk/core';
import type { WeatherState } from '@iwsdk/cardinal-simulation';

const SKY_STOPS: Array<{ hour: number; color: number }> = [
  { hour: 0, color: 0x0b1026 },
  { hour: 5, color: 0x0b1026 },
  { hour: 7, color: 0xf59e0b },
  { hour: 10, color: 0x7ec8f7 },
  { hour: 16, color: 0x7ec8f7 },
  { hour: 19, color: 0x7c3aed },
  { hour: 21, color: 0x0b1026 },
  { hour: 24, color: 0x0b1026 },
];

const STAR_COUNT = 400;
const RAIN_COUNT = 600;
const RAIN_TOP = 12;
const RAIN_SPEED = 12; // m/s downward

export class CelestialVisuals {
  private sun: DirectionalLight;
  private moon: DirectionalLight;
  private hemi: HemisphereLight;
  private skyDome: Mesh;
  private skyMaterial: MeshBasicMaterial;
  private stars: Points;
  private starsMaterial: PointsMaterial;
  private rain: Points;
  private rainGeometry: BufferGeometry;
  private lastElapsed = 0;

  // Pre-allocated scratch colors (never allocate in update()).
  private skyColor = new Color();
  private stopColorA = new Color();
  private stopColorB = new Color();

  constructor(root: Group) {
    this.sun = new DirectionalLight(0xfff2d0, 1.0);
    this.sun.name = 'Celestial_Sun';
    root.add(this.sun);

    this.moon = new DirectionalLight(0xbfd4ff, 0.15);
    this.moon.name = 'Celestial_Moon';
    root.add(this.moon);

    this.hemi = new HemisphereLight(0xbfdcff, 0x3d2f1f, 0.5);
    this.hemi.name = 'Celestial_Hemisphere';
    root.add(this.hemi);

    this.skyMaterial = new MeshBasicMaterial({ color: 0x7ec8f7, side: BackSide, fog: false });
    this.skyDome = new Mesh(new SphereGeometry(90, 24, 16), this.skyMaterial);
    this.skyDome.name = 'Celestial_SkyDome';
    root.add(this.skyDome);

    // Stars: random points on the upper dome (decor — Math.random tolerated).
    const starPositions: number[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45; // upper hemisphere
      const r = 85;
      starPositions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
    this.starsMaterial = new PointsMaterial({
      color: 0xffffff,
      size: 0.35,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    this.stars = new Points(starGeometry, this.starsMaterial);
    this.stars.name = 'Celestial_Stars';
    root.add(this.stars);

    // Rain: recycled particle volume above the play area.
    const rainPositions: number[] = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      rainPositions.push(
        (Math.random() - 0.5) * 40,
        Math.random() * RAIN_TOP,
        (Math.random() - 0.5) * 40
      );
    }
    this.rainGeometry = new BufferGeometry();
    this.rainGeometry.setAttribute('position', new Float32BufferAttribute(rainPositions, 3));
    const rainMaterial = new PointsMaterial({
      color: 0x9db8d9,
      size: 0.06,
      transparent: true,
      opacity: 0.7,
    });
    this.rain = new Points(this.rainGeometry, rainMaterial);
    this.rain.name = 'Celestial_Rain';
    this.rain.visible = false;
    root.add(this.rain);
  }

  update(hour: number, weather: WeatherState, elapsed: number): void {
    const dt = Math.min(0.25, Math.max(0, elapsed - this.lastElapsed));
    this.lastElapsed = elapsed;

    // Sun arc: rises at 6h in the east, sets at 20h.
    const sunAngle = ((hour - 6) / 14) * Math.PI;
    const sunHeight = Math.sin(sunAngle);
    const weatherDim = weather === 'clear' ? 1 : weather === 'cloudy' ? 0.6 : 0.35;
    this.sun.position.set(Math.cos(Math.PI - sunAngle) * 30, sunHeight * 30, -10);
    this.sun.intensity = Math.max(0, sunHeight) * weatherDim;

    // Moon on the opposite arc, only meaningful at night.
    this.moon.position.set(Math.cos(-sunAngle) * 30, -sunHeight * 30, 10);
    this.moon.intensity = sunHeight < 0 ? 0.15 : 0;

    this.hemi.intensity = 0.15 + Math.max(0, sunHeight) * 0.55;

    // Sky color: linear interpolation between the neighboring palette stops.
    let a = SKY_STOPS[0]!;
    let b = SKY_STOPS[SKY_STOPS.length - 1]!;
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      if (hour >= SKY_STOPS[i]!.hour && hour <= SKY_STOPS[i + 1]!.hour) {
        a = SKY_STOPS[i]!;
        b = SKY_STOPS[i + 1]!;
        break;
      }
    }
    const span = b.hour - a.hour;
    const t = span > 0 ? (hour - a.hour) / span : 0;
    this.stopColorA.setHex(a.color);
    this.stopColorB.setHex(b.color);
    this.skyColor.copy(this.stopColorA).lerp(this.stopColorB, t);
    if (weather === 'storm') this.skyColor.multiplyScalar(0.5);
    else if (weather === 'rain') this.skyColor.multiplyScalar(0.75);
    this.skyMaterial.color.copy(this.skyColor);

    // Stars fade in once the sun is below the horizon.
    const targetStarOpacity = sunHeight < -0.05 ? 1 : sunHeight < 0.05 ? 0.5 : 0;
    this.starsMaterial.opacity += (targetStarOpacity - this.starsMaterial.opacity) * Math.min(1, dt * 2);

    // Rain particles: recycle from top while wet.
    const wet = weather === 'rain' || weather === 'storm';
    this.rain.visible = wet;
    if (wet) {
      const positions = this.rainGeometry.getAttribute('position');
      for (let i = 0; i < RAIN_COUNT; i++) {
        let y = positions.getY(i) - RAIN_SPEED * dt;
        if (y < 0) y += RAIN_TOP;
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
    }
  }

  dispose(): void {
    this.sun.removeFromParent();
    this.moon.removeFromParent();
    this.hemi.removeFromParent();
    this.skyDome.removeFromParent();
    this.stars.removeFromParent();
    this.rain.removeFromParent();
  }
}
