export type RngState = [number, number, number, number];

/**
 * Deterministic xorshift128 PRNG. All engine stochasticity flows through one
 * instance owned by the kernel — never Math.random() (spec §8.2). State is
 * serializable so snapshots resume the exact sequence.
 */
export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    // splitmix32 expands one 32-bit seed into the 128-bit xorshift state.
    let h = seed >>> 0;
    const splitmix = (): number => {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = splitmix();
    this.s1 = splitmix();
    this.s2 = splitmix();
    this.s3 = splitmix();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    const t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    let x = (t ^ (t << 11)) >>> 0;
    x = (x ^ (x >>> 8)) >>> 0;
    this.s0 = (x ^ s ^ (s >>> 19)) >>> 0;
    return this.s0 / 0x1_0000_0000;
  }

  /** Uniform integer in [minIncl, maxExcl). */
  int(minIncl: number, maxExcl: number): number {
    return minIncl + Math.floor(this.next() * (maxExcl - minIncl));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length)] as T;
  }

  getState(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: RngState): void {
    this.s0 = state[0];
    this.s1 = state[1];
    this.s2 = state[2];
    this.s3 = state[3];
  }
}
