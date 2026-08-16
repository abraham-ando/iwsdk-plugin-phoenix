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
