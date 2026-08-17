export interface Preset {
  id: string;
  version: number;
  family: string;
  /** Gènes explicitement fixés. Les absents prennent la valeur médiane. */
  genes: Readonly<Record<string, number>>;
  ageRange: readonly [number, number];
  note: string;
}
