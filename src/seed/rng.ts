// Deterministic randomness for the seed generator. Same seed string, same company.

/** xmur3 string hash, used to turn the seed string into 32 bit state. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export type Rng = {
  /** Float in [0, 1). */
  next(): number;
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(xs: readonly T[]): T[];
  sample<T>(xs: readonly T[], n: number): T[];
  weighted<T extends string>(weights: Partial<Record<T, number>>): T;
  /** An independent stream for one sub-task, so adding a step does not reshuffle the others. */
  fork(label: string): Rng;
};

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  // mulberry32
  let a = seedFn();
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    sample: (xs, n) => rng.shuffle(xs).slice(0, n),
    weighted: (weights) => {
      const entries = Object.entries(weights) as [string, number][];
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [k, w] of entries) {
        r -= w;
        if (r <= 0) return k as never;
      }
      return entries[entries.length - 1][0] as never;
    },
    fork: (label) => createRng(`${seed}::${label}`),
  };
  return rng;
}
