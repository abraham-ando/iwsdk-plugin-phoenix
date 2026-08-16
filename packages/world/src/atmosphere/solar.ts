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
  return AXIAL_TILT_DEG * Math.sin((360 / 365) * (dayOfYear - 81) * DEG);
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
