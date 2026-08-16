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
