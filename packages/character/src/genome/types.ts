/**
 * Contrat minimal de générateur aléatoire.
 *
 * Structurel et non importé : le paquet n'a aucune dépendance, et le `Rng`
 * xorshift128 de `@iwsdk/cardinal-simulation` le satisfait sans rien changer.
 * C'est ce qui permet à l'hérédité d'être rejouable depuis la graine du monde.
 */
export interface RngLike {
  /** Flottant uniforme dans [0, 1). */
  next(): number;
}

export interface Genome {
  readonly family: string;
  readonly genes: Readonly<Record<string, number>>;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
